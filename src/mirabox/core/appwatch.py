"""앞으로 나온 앱을 감시한다.

프로필에 앱을 지정해 두면 그 앱이 활성화될 때 자동으로 전환한다.

NSWorkspace 알림을 쓰면 폴링이 필요 없다. 알림은 실행 루프가 돌아야 오는데,
조작 화면에서는 Qt 가 그 루프를 돌리므로 그대로 붙는다. 화면 없이 데몬만
돌릴 때는 실행 루프가 없으므로 주기적으로 직접 물어본다.
"""

from __future__ import annotations

import threading

try:
    from AppKit import NSWorkspace
    _HAVE_APPKIT = True
except Exception:                     # pyobjc 가 없거나 macOS 가 아닌 경우
    NSWorkspace = None
    _HAVE_APPKIT = False


def frontmost() -> str:
    """앞에 나와 있는 앱 이름. 알 수 없으면 빈 문자열."""
    if not _HAVE_APPKIT:
        return ""
    try:
        app = NSWorkspace.sharedWorkspace().frontmostApplication()
        return str(app.localizedName() or "") if app else ""
    except Exception:
        return ""


def running_apps() -> list[str]:
    """조작 화면에서 앱을 고를 때 쓸 목록."""
    if not _HAVE_APPKIT:
        return []
    try:
        apps = NSWorkspace.sharedWorkspace().runningApplications()
        names = {str(a.localizedName() or "") for a in apps
                 if a.activationPolicy() == 0}     # 독에 보이는 앱만
        return sorted(n for n in names if n)
    except Exception:
        return []


class AppWatcher:
    """앞선 앱이 바뀌면 콜백한다.

    알림을 받을 실행 루프가 없을 수 있어 주기 확인을 함께 둔다. 둘 다
    같은 콜백을 부르지만 값이 바뀌었을 때만 알린다.
    """

    def __init__(self, on_change, interval: float = 1.5):
        self._on_change = on_change
        self._interval = interval
        self._current = ""
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    def _check(self) -> None:
        name = frontmost()
        if name and name != self._current:
            self._current = name
            try:
                self._on_change(name)
            except Exception:
                pass

    def _loop(self) -> None:
        while not self._stop.is_set():
            self._check()
            if self._stop.wait(self._interval):
                return

    def start(self) -> None:
        if not _HAVE_APPKIT or self._thread:
            return
        self._thread = threading.Thread(target=self._loop, daemon=True,
                                        name="appwatch")
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=2)
            self._thread = None

    @property
    def current(self) -> str:
        return self._current
