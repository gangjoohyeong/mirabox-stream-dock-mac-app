"""로그인 시 자동 실행 (launchd).

에이전트는 화면 없는 데몬을 돌린다. 조작 화면을 열면 같은 기기를 두고
다투게 되므로, 화면이 뜨는 동안에는 에이전트를 잠시 내렸다가 닫을 때
되살린다. 기기는 한 프로세스만 점유할 수 있다.
"""

from __future__ import annotations

import os
import plistlib
import subprocess
import sys
from pathlib import Path

LABEL = "com.jkang.mirabox"
PLIST_PATH = Path.home() / "Library" / "LaunchAgents" / f"{LABEL}.plist"
LOG_DIR = Path.home() / "Library" / "Logs" / "mirabox"


def _domain() -> str:
    return f"gui/{os.getuid()}"


def _daemon_command() -> list[str]:
    """설치된 콘솔 스크립트를 먼저 쓰고, 없으면 현재 인터프리터로 모듈을 부른다."""
    script = Path(sys.executable).with_name("mirabox")
    if script.exists():
        return [str(script)]
    return [sys.executable, "-m", "mirabox.core.daemon"]


def _launchctl(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(["launchctl", *args], capture_output=True, text=True)


def is_installed() -> bool:
    return PLIST_PATH.exists()


def is_running() -> bool:
    return _launchctl("print", f"{_domain()}/{LABEL}").returncode == 0


def install() -> None:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    PLIST_PATH.parent.mkdir(parents=True, exist_ok=True)
    plist = {
        "Label": LABEL,
        "ProgramArguments": _daemon_command(),
        "RunAtLoad": True,
        "KeepAlive": {"SuccessfulExit": False},
        "StandardOutPath": str(LOG_DIR / "daemon.log"),
        "StandardErrorPath": str(LOG_DIR / "daemon.err"),
        "ProcessType": "Background",
    }
    PLIST_PATH.write_bytes(plistlib.dumps(plist))
    start()


def uninstall() -> None:
    stop()
    PLIST_PATH.unlink(missing_ok=True)


def start() -> bool:
    if not PLIST_PATH.exists():
        return False
    _launchctl("bootout", _domain(), str(PLIST_PATH))     # 이미 떠 있으면 내린다
    return _launchctl("bootstrap", _domain(), str(PLIST_PATH)).returncode == 0


def stop() -> bool:
    return _launchctl("bootout", _domain(), str(PLIST_PATH)).returncode == 0


class Suspension:
    """조작 화면이 떠 있는 동안 에이전트를 내려 둔다."""

    def __init__(self) -> None:
        self._was_running = False

    def __enter__(self) -> "Suspension":
        self._was_running = is_installed() and is_running()
        if self._was_running:
            stop()
        return self

    def __exit__(self, *_exc) -> None:
        if self._was_running:
            start()


def main() -> None:
    """uv run mirabox-agent [install|uninstall|status]"""
    command = sys.argv[1] if len(sys.argv) > 1 else "status"
    if command == "install":
        install()
        print(f"등록 완료: {PLIST_PATH}")
        print(f"실행 명령: {' '.join(_daemon_command())}")
        print(f"로그: {LOG_DIR}")
    elif command == "uninstall":
        uninstall()
        print("해제 완료")
    else:
        print(f"등록됨: {'예' if is_installed() else '아니오'}")
        print(f"실행중: {'예' if is_running() else '아니오'}")
        if is_installed():
            print(f"plist: {PLIST_PATH}")


if __name__ == "__main__":
    main()
