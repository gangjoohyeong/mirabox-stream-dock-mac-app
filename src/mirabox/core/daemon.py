"""데몬 루프.

등록된 소스 중 보드에 올라온 키가 요구하는 것만 켠다. 주기적으로 키를 그려
기기에 보내고, 키 입력을 받아 설정된 동작을 실행한다.

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
from . import config as config_module
from . import shell
from .device import KEY_COUNT, DeviceError, StreamDock293S, encode_key_image
from .registry import KEYS, SOURCES, sources_for
from .render import blank
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
    def __init__(self, cfg: config_module.Config):
        self.cfg = cfg
        self.stop_event = threading.Event()
        self.collector: Collector | None = None
        self._sent: dict[int, bytes] = {}
        self._wake = threading.Event()

    # ---------- 소스 ----------

    def start_sources(self) -> None:
        needed = sources_for(self.cfg.keys_in_use())
        if not needed:
            return
        self.collector = Collector(needed, on_update=lambda _n: self._wake.set())
        self.collector.start()
        print(f"소스 {len(needed)}종 수집 시작: {', '.join(sorted(needed))}")

    def stop_sources(self) -> None:
        if self.collector:
            self.collector.stop()
            self.collector = None

    def state(self) -> State:
        return self.collector.state() if self.collector else State()

    # ---------- 그리기 ----------

    def paint(self, dock: StreamDock293S, state: State, force: bool = False) -> int:
        """바뀐 키만 다시 보낸다. USB 왕복이 비싸다."""
        sent = 0
        for index in range(KEY_COUNT):
            name = self.cfg.layout[index]
            entry = KEYS.get(name) if name else None
            if entry is None:
                image = blank(index, "", "")
            else:
                try:
                    image = entry.render(index, state)
                except Exception as exc:
                    print(f"{name} 렌더 실패: {exc}", file=sys.stderr)
                    image = blank(index, entry.label, "err")
            payload = encode_key_image(image, index)
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
        command = self.cfg.actions.get(str(index))
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
                    self.paint(dock, self.state())

    def run(self) -> None:
        self.start_sources()
        try:
            while not self.stop_event.is_set():
                try:
                    self.serve()
                except DeviceError as exc:
                    print(f"{exc} {RECONNECT_SECONDS}초 뒤 재시도", file=sys.stderr)
                except OSError as exc:
                    print(f"기기 통신 끊김: {exc}. 재연결 시도", file=sys.stderr)
                if self.stop_event.wait(RECONNECT_SECONDS):
                    break
        finally:
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
