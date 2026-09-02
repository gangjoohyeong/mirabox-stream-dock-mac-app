"""데몬 루프.

활성 프로필의 칸을 그려 기기에 보내고, 키 입력을 받아 설정된 동작을
실행한다. 앞으로 나온 앱에 묶인 프로필이 있으면 그쪽으로 바꾼다.

기기가 USB 에서 빠졌다 들어오는 일이 잦다. 벤더 앱은 그때 죽지만 여기서는
다시 붙는다. 종료할 때는 반드시 close() 를 태운다. HID 핸들을 쥔 채로
죽으면 기기가 잠겨서 물리적 재연결이 필요해진다.
"""

from __future__ import annotations

import signal
import sys
import threading
import time

from .. import integrations  # noqa: F401  소스와 키를 등록시킨다
from . import actions as actions_module
from . import config as config_module
from . import shell
from .appwatch import AppWatcher
from .device import KEY_COUNT, DeviceError, StreamDock293S, encode_key_image
from .registry import KEYS, SOURCES, sources_for
from .render import blank, empty
from .state import State

RECONNECT_SECONDS = 3.0


class Collector:
    """필요한 소스만 각자 주기로 모은다."""

    def __init__(self, wanted: set[str], on_update=None):
        self.wanted = {name for name in wanted if name in SOURCES}
        self.values: dict[str, object] = {}
        self.errors: dict[str, str] = {}
        self._on_update = on_update or (lambda _name: None)
        self._stop = threading.Event()
        self._threads: list[threading.Thread] = []

    def _loop(self, name: str, start_delay: float) -> None:
        entry = SOURCES[name]
        if self._stop.wait(start_delay):     # 동시에 몰리지 않게 어긋나게 시작한다
            return
        while not self._stop.is_set():
            try:
                self.values[name] = entry.fetch()
                self.errors.pop(name, None)
            except Exception as exc:
                self.errors[name] = f"{type(exc).__name__}: {exc}"
            self._on_update(name)
            if self._stop.wait(entry.every):
                return

    def start(self) -> None:
        for index, name in enumerate(sorted(self.wanted)):
            thread = threading.Thread(target=self._loop, args=(name, index * 1.5),
                                      daemon=True, name=f"source-{name}")
            thread.start()
            self._threads.append(thread)

    def stop(self) -> None:
        self._stop.set()
        for thread in self._threads:
            thread.join(timeout=2)
        self._threads.clear()

    def state(self) -> State:
        return State(data=dict(self.values), errors=dict(self.errors))


class Daemon:
    """콜백은 UI 가 붙을 때만 쓴다. CLI 로 돌 때는 없어도 된다.

    on_status(text, connected) 는 연결 상태가 바뀔 때,
    on_painted(state) 는 키를 다시 그린 뒤,
    on_profile(name) 은 앱 전환으로 프로필이 바뀔 때 호출된다. 전부 데몬
    스레드에서 불리므로 UI 는 시그널로 넘겨 받아야 한다.
    """

    def __init__(self, cfg: config_module.Config, *,
                 on_status=None, on_painted=None, on_profile=None):
        self.cfg = cfg
        self.stop_event = threading.Event()
        self.collector: Collector | None = None
        self._sent: dict[int, bytes] = {}
        self._wake = threading.Event()
        self._on_status = on_status or (lambda _text, _connected: None)
        self._on_painted = on_painted or (lambda _state: None)
        self._on_profile = on_profile or (lambda _name: None)
        self._watcher = AppWatcher(self._on_front_app)

    def notify(self) -> None:
        """설정이 바뀌었으니 다음 순번에 다시 그리라는 신호."""
        self._sent.clear()
        self._wake.set()

    # ---------- 프로필 ----------

    def _on_front_app(self, app_name: str) -> None:
        profile = self.cfg.profile_for_app(app_name)
        if profile and profile.name != self.cfg.active:
            self.cfg.active = profile.name
            print(f"{app_name} 때문에 프로필 전환: {profile.name}")
            self._on_profile(profile.name)
            self.notify()

    def switch_profile(self, name: str) -> None:
        if name == self.cfg.active:
            return
        self.cfg.active = name
        self.restart_sources()
        self.notify()

    # ---------- 소스 ----------

    def _needed_sources(self) -> set[str]:
        """활성 프로필과, 앱에 묶여 언제든 활성화될 프로필의 것을 함께 켠다."""
        names = set(self.cfg.profile().keys_in_use())
        for profile in self.cfg.profiles:
            if profile.app:
                names |= profile.keys_in_use()
        return sources_for(names)

    def start_sources(self) -> None:
        needed = self._needed_sources()
        if not needed:
            return
        self.collector = Collector(needed, on_update=lambda _n: self._wake.set())
        self.collector.start()
        print(f"소스 {len(needed)}종 수집 시작: {', '.join(sorted(needed))}")

    def restart_sources(self) -> None:
        """배치가 바뀌어 필요한 소스가 달라졌을 때."""
        self.stop_sources()
        self.start_sources()

    def stop_sources(self) -> None:
        if self.collector:
            self.collector.stop()
            self.collector = None

    def state(self) -> State:
        return self.collector.state() if self.collector else State()

    # ---------- 그리기 ----------

    def render_slot(self, index: int, state: State):
        slot = self.cfg.profile().slots[index]
        entry = KEYS.get(slot.key) if slot.key else None
        if entry is None:
            return empty(index)
        try:
            return entry.render(index, state, slot.options)
        except Exception as exc:
            print(f"{slot.key} 렌더 실패: {exc}", file=sys.stderr)
            return blank(index, entry.label, "err")

    def paint(self, dock: StreamDock293S, state: State, force: bool = False) -> int:
        """바뀐 키만 다시 보낸다. USB 왕복이 비싸다."""
        sent = 0
        for index in range(KEY_COUNT):
            payload = encode_key_image(self.render_slot(index, state), index)
            if not force and self._sent.get(index) == payload:
                continue
            dock.set_key_image(index, payload)
            self._sent[index] = payload
            sent += 1
        if sent:
            dock.refresh()
        return sent

    # ---------- 입력 ----------

    def on_press(self, index: int) -> None:
        slot = self.cfg.profile().slots[index]
        command = actions_module.to_command(slot.action)
        if not command:
            return
        try:
            shell.spawn(command)
            print(f"키 {index} 실행: {command}")
        except Exception as exc:
            print(f"키 {index} 실행 실패: {exc}", file=sys.stderr)

    # ---------- 루프 ----------

    def serve(self) -> None:
        """기기에 붙어 있는 동안 도는 루프. 끊기면 예외로 빠져나온다."""
        with StreamDock293S() as dock:
            print("기기 연결됨")
            self._on_status("기기 연결됨", True)
            dock.connect()
            dock.set_brightness(self.cfg.brightness)
            self._sent.clear()

            # 부팅 로딩 화면은 CLE 로 지워지지 않는다. 전부 덮어써야 사라진다.
            self.paint(dock, self.state(), force=True)
            print(f"{KEY_COUNT}칸 초기 표시 완료")

            next_paint = time.monotonic() + self.cfg.refresh_seconds
            while not self.stop_event.is_set():
                for event in dock.read_events(timeout_ms=200):
                    if event.pressed:
                        self.on_press(event.key)
                if self._wake.is_set() or time.monotonic() >= next_paint:
                    self._wake.clear()
                    next_paint = time.monotonic() + self.cfg.refresh_seconds
                    dock.set_brightness(self.cfg.brightness)
                    state = self.state()
                    self.paint(dock, state)
                    self._on_painted(state)

    def run(self) -> None:
        self.start_sources()
        self._watcher.start()
        try:
            while not self.stop_event.is_set():
                try:
                    self.serve()
                except DeviceError as exc:
                    print(f"{exc} {RECONNECT_SECONDS}초 뒤 재시도", file=sys.stderr)
                    self._on_status("기기를 찾는 중", False)
                except OSError as exc:
                    print(f"기기 통신 끊김: {exc}. 재연결 시도", file=sys.stderr)
                    self._on_status("연결이 끊겨 다시 시도하는 중", False)
                if self.stop_event.wait(RECONNECT_SECONDS):
                    break
        finally:
            self._watcher.stop()
            self.stop_sources()
            print("종료")


def main() -> None:
    cfg = config_module.load()
    if not config_module.CONFIG_PATH.exists():
        config_module.save(cfg)
        print(f"기본 설정을 만들었다: {config_module.CONFIG_PATH}")

    daemon = Daemon(cfg)

    def shutdown(_signum, _frame):
        # HID 핸들을 쥔 채 죽으면 기기가 잠긴다. 반드시 정상 종료시킨다.
        daemon.stop_event.set()

    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)
    daemon.run()


if __name__ == "__main__":
    main()
