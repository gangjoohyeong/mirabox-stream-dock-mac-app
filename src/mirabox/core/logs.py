"""번들 실행 로그.

PyInstaller 로 만든 창 앱은 stdout 을 버린다. 얼어붙은 실행이면 파일로
돌린다. 개발 중에는 그대로 터미널에 남긴다.
"""

from __future__ import annotations

import sys
from pathlib import Path

LOG_DIR = Path.home() / "Library" / "Logs" / "mirabox"


def redirect_if_frozen(name: str = "app.log") -> Path | None:
    if not getattr(sys, "frozen", False):
        return None
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    path = LOG_DIR / name
    stream = open(path, "a", buffering=1, encoding="utf-8")
    sys.stdout = stream
    sys.stderr = stream
    print(f"--- 시작 {__import__('datetime').datetime.now():%Y-%m-%d %H:%M:%S} ---")
    return path
