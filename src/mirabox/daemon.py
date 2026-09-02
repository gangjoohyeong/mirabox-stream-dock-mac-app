"""데몬 루프.

주기적으로 데이터를 모아 키를 그리고 기기에 보낸다. 키 입력을 받아 설정된
명령을 실행한다.

기기가 USB 에서 빠졌다 들어오는 일이 잦다. 벤더 앱은 그때 죽지만 여기서는
다시 붙는다. 종료할 때는 반드시 close() 를 태운다. HID 핸들을 쥔 채로
죽으면 기기가 잠겨서 물리적 재연결이 필요해진다.
"""

from __future__ import annotations

import signal
import subprocess
import sys
import threading
import time

from . import config as config_module
from .device import KEY_COUNT, DeviceError, StreamDock293S
from .render import State, blank, render
from .sources import NEEDS_FEED, NEEDS_USAGE, Collector, Usage, external, read_snapshot

RECONNECT_SECONDS = 3.0


class Daemon:
    def __init__(self, cfg: config_module.Config):
        self.cfg = cfg
        self.stop_event = threading.Event()
        self.usage: Usage | None = None
        self.collector: Collector | None = None
        self._last_images: dict[int, bytes] = {}
        self._wake = threading.Event()

    # ---------- 소스 ----------

    def start_sources(self) -> None:
        wanted = self.cfg.keys_in_use()
        if wanted & NEEDS_USAGE:
            self.usage = Usage()
        feeds = {NEEDS_FEED[name] for name in wanted if name in NEEDS_FEED}
        if feeds:
            self.collector = Collector(feeds, on_update=lambda _n: self._wake.set())
            self.collector.start()

    def stop_sources(self) -> None:
        if self.collector:
            self.collector.stop()
            self.collector = None

    def build_state(self) -> State:
        if self.usage:
            try:
                self.usage.refresh()
            except Exception as exc:
                print(f"jsonl 갱신 실패: {exc}", file=sys.stderr)
        return State(snap=read_snapshot(), usage=self.usage,
                     feeds=dict(self.collector.values) if self.collector else {})

    # ---------- 그리기 ----------

    def paint(self, dock: StreamDock293S, state: State, force: bool = False) -> int:
        """바뀐 키만 다시 보낸다. USB 왕복이 비싸다."""
        sent = 0
        for key in range(KEY_COUNT):
            name = self.cfg.layout[key]
            image = blank(key, "", "") if name is None else render(name, key, state)
            payload = _encode(image, key)
            if not force and self._last_images.get(key) == payload:
                continue
            dock.set_key_image(key, payload)
            self._last_images[key] = payload
            sent += 1
        if sent:
            dock.refresh()
        return sent

    # ---------- 입력 ----------

    def handle_press(self, key: int) -> None:
        command = self.cfg.actions.get(str(key))
        if not command:
            return
        try:
            subprocess.Popen(["/bin/sh", "-c", command], env=external.ENV,
                             stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            print(f"키 {key} 실행: {command}")
        except Exception as exc:
            print(f"키 {key} 실행 실패: {exc}", file=sys.stderr)

    # ---------- 루프 ----------

    def run_once(self) -> None:
        """기기에 붙어 있는 동안 도는 루프. 연결이 끊기면 예외로 빠져나온다."""
        with StreamDock293S() as dock:
            print("기기 연결됨")
            dock.connect()
            dock.set_brightness(self.cfg.brightness)
            self._last_images.clear()

            state = self.build_state()
            # 부팅 로딩 화면은 CLE 로 지워지지 않는다. 전부 덮어써야 사라진다.
            self.paint(dock, state, force=True)
            print(f"{KEY_COUNT}칸 초기 표시 완료")

            next_paint = time.monotonic() + self.cfg.refresh_seconds
            while not self.stop_event.is_set():
                for event in dock.read_events(timeout_ms=200):
                    if event.pressed:
                        self.handle_press(event.key)

                if self._wake.is_set() or time.monotonic() >= next_paint:
                    self._wake.clear()
                    next_paint = time.monotonic() + self.cfg.refresh_seconds
                    self.paint(dock, self.build_state())

    def run(self) -> None:
        self.start_sources()
        try:
            while not self.stop_event.is_set():
                try:
                    self.run_once()
                except DeviceError as exc:
                    print(f"{exc} {RECONNECT_SECONDS}초 뒤 재시도", file=sys.stderr)
                except OSError as exc:
                    print(f"기기 통신 끊김: {exc}. 재연결 시도", file=sys.stderr)
                if self.stop_event.wait(RECONNECT_SECONDS):
                    break
        finally:
            self.stop_sources()
            print("종료")


def _encode(image, key: int) -> bytes:
    from .device import encode_key_image
    return encode_key_image(image, key)


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
