"""외부 명령 실행.

연동 대부분이 바깥 CLI 를 부른다. 자격증명은 그 도구들이 들고 있으므로 이
저장소에 비밀정보가 없다. launchd 로 띄우면 PATH 가 빈약해서 직접 채운다.
"""

from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path
from typing import Any


def _path() -> str:
    dirs = [str(Path.home() / ".local" / "bin")]
    nvm = Path.home() / ".nvm" / "versions" / "node"
    if nvm.is_dir():
        dirs += [str(p / "bin") for p in sorted(nvm.iterdir(), reverse=True)]
    dirs += ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin",
             "/usr/sbin", "/sbin"]
    return ":".join(dirs)


ENV = {**os.environ, "PATH": _path(), "LC_ALL": "C"}


def run(script: str, timeout: float) -> str:
    """셸 한 줄을 돌리고 stdout 을 돌려준다. 실패해도 예외를 던지지 않는다."""
    proc = subprocess.run(["/bin/sh", "-c", script], capture_output=True,
                          timeout=timeout, env=ENV)
    return proc.stdout.decode("utf-8", errors="replace")


def spawn(script: str) -> None:
    """키 액션처럼 결과를 기다리지 않는 실행."""
    subprocess.Popen(["/bin/sh", "-c", script], env=ENV,
                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def json_after_noise(text: str) -> Any:
    """일부 CLI 는 stdout 앞에 안내 문구를 한 줄 붙인다."""
    start = text.find("{")
    if start < 0:
        return None
    try:
        return json.loads(text[start:])
    except ValueError:
        return None
