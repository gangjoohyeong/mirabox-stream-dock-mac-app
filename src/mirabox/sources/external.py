"""외부 데이터 수집.

각 항목은 자기 주기로 백그라운드 스레드에서 실행되고 결과만 메모리에 남는다.
자격증명은 전부 바깥 도구가 들고 있다. gws 는 OAuth 키링, jira 는
~/.config, GitLab 은 macOS 키체인, 빌드 서버는 ssh 키다. 이 저장소에는
비밀정보를 두지 않는다.

명령이 멈춰도 키 갱신을 막지 않도록 전부 타임아웃을 건다.
"""

from __future__ import annotations

import json
import os
import subprocess
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable


def _path_env() -> dict[str, str]:
    """launchd 로 띄우면 PATH 가 빈약하다. 직접 채운다."""
    dirs = [str(Path.home() / ".local" / "bin")]
    nvm = Path.home() / ".nvm" / "versions" / "node"
    if nvm.is_dir():
        dirs += [str(p / "bin") for p in sorted(nvm.iterdir(), reverse=True)]
    dirs += ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin",
             "/usr/sbin", "/sbin"]
    env = dict(os.environ)
    env["PATH"] = ":".join(dirs)
    env["LC_ALL"] = "C"
    return env


ENV = _path_env()


def sh(script: str, timeout: float) -> str:
    proc = subprocess.run(["/bin/sh", "-c", script], capture_output=True,
                          timeout=timeout, env=ENV)
    return proc.stdout.decode("utf-8", errors="replace")


def json_after_noise(text: str) -> Any:
    """gws 는 stdout 앞에 키링 안내를 한 줄 붙인다."""
    start = text.find("{")
    if start < 0:
        return None
    try:
        return json.loads(text[start:])
    except ValueError:
        return None


def _iso(when: datetime) -> str:
    return when.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# ---------- 개별 수집기 ----------

def _mail() -> dict:
    data = json_after_noise(
        sh("""gws gmail users labels get --params '{"userId":"me","id":"INBOX"}' 2>/dev/null""", 20))
    if not data:
        raise RuntimeError("gmail 응답을 파싱하지 못했다")
    return {"unread": data.get("messagesUnread", 0),
            "threads": data.get("threadsUnread", 0)}


def _cal() -> dict:
    now = datetime.now(timezone.utc)
    params = json.dumps({
        "calendarId": "primary",
        "timeMin": _iso(now),
        "timeMax": _iso(now + timedelta(days=7)),
        "maxResults": 10,
        "singleEvents": True,
        "orderBy": "startTime",
    })
    data = json_after_noise(
        sh(f"gws calendar events list --params '{params}' 2>/dev/null", 20))
    if data is None:
        raise RuntimeError("calendar 응답을 파싱하지 못했다")
    for item in data.get("items", []):
        start = (item.get("start") or {}).get("dateTime")
        if not start:
            continue                       # 종일 일정은 제외한다
        when = datetime.fromisoformat(start)
        if when > now:
            return {"in_min": round((when - now).total_seconds() / 60),
                    "title": item.get("summary", "")}
    return {"in_min": None, "title": ""}


def _jira() -> dict:
    data = json_after_noise(sh("jira today 2>/dev/null", 25))
    if data is None:
        raise RuntimeError("jira 응답을 파싱하지 못했다")
    return {"items": len(data.get("items") or [])}


def _mr() -> dict:
    script = """
T=$(security find-generic-password -s gitlab.wisenut.kr -a jkang -w 2>/dev/null) || exit 1
[ -n "$T" ] || exit 1
curl -s --max-time 20 -H "PRIVATE-TOKEN: $T" \
  "https://gitlab.wisenut.kr/api/v4/merge_requests?scope=all&reviewer_username=jkang&state=opened&per_page=100"
"""
    try:
        rows = json.loads(sh(script, 30))
    except ValueError as exc:
        raise RuntimeError("gitlab 응답을 파싱하지 못했다") from exc
    if not isinstance(rows, list):
        raise RuntimeError("gitlab 응답 형태가 다르다")
    return {"count": len(rows)}


def _build() -> dict:
    # 원격 명령은 작은따옴표로 감싸 넘긴다. 그래서 명령 안에 작은따옴표도
    # $ 도 쓰면 안 된다. 둘 다 로컬 셸이 먼저 건드린다.
    remote = ('cut -d" " -f1 /proc/loadavg; nproc; '
              'df -P / | tail -1 | tr -s " " | cut -d" " -f5')
    out = sh("ssh -o BatchMode=yes -o ConnectTimeout=8 "
             f"-o StrictHostKeyChecking=accept-new sphere-build '{remote}' 2>/dev/null", 25)
    parts = out.strip().split("\n")
    if len(parts) < 3:
        raise RuntimeError("빌드 서버 응답이 짧다")
    return {"load": float(parts[0]),
            "cores": int(parts[1]),
            "diskPct": int(parts[2].replace("%", ""))}


# 이름 -> (수집 함수, 주기 초)
FEEDS: dict[str, tuple[Callable[[], dict], float]] = {
    "mail": (_mail, 60),
    "cal": (_cal, 60),
    "jira": (_jira, 300),
    "mr": (_mr, 120),
    "build": (_build, 300),
}


class Collector:
    """필요한 항목만 백그라운드로 모은다."""

    def __init__(self, wanted: set[str], on_update: Callable[[str], None] | None = None):
        self.wanted = {name for name in wanted if name in FEEDS}
        self.values: dict[str, dict] = {}
        self.errors: dict[str, str] = {}
        self._on_update = on_update or (lambda _name: None)
        self._stop = threading.Event()
        self._threads: list[threading.Thread] = []

    def _loop(self, name: str, delay: float) -> None:
        fn, every = FEEDS[name]
        if self._stop.wait(delay):        # 동시에 몰리지 않게 어긋나게 시작한다
            return
        while not self._stop.is_set():
            try:
                self.values[name] = fn()
                self.errors.pop(name, None)
            except Exception as exc:
                self.errors[name] = f"{type(exc).__name__}: {exc}"
            self._on_update(name)
            if self._stop.wait(every):
                return

    def start(self) -> None:
        for index, name in enumerate(sorted(self.wanted)):
            thread = threading.Thread(target=self._loop, args=(name, index * 1.5),
                                      daemon=True, name=f"feed-{name}")
            thread.start()
            self._threads.append(thread)

    def stop(self) -> None:
        self._stop.set()
        for thread in self._threads:
            thread.join(timeout=2)
        self._threads.clear()
