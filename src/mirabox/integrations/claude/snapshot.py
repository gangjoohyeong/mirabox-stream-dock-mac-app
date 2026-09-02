"""Claude Code 계정 한도를 읽는다.

Claude Code 는 statusLine 명령에 세션 상태 JSON 을 stdin 으로 넘기고 그 안에
rate_limits 가 들어 있다 (2.1.80 부터. 5시간과 7일 창의 used_percentage 와
resets_at). ~/.claude/statusline-capture.sh 가 그 payload 를 아래 파일로
떨궈두면 이 모듈이 읽는다.

대화형 세션이 떠 있을 때만 갱신되므로 창이 이미 지났는지는 resets_at 으로
직접 판단한다.
"""

from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any

SNAPSHOT = Path.home() / ".claude" / "usage-snapshot.json"


def _window(raw: dict | None, now: float) -> dict | None:
    if not raw or not isinstance(raw.get("used_percentage"), (int, float)):
        return None
    resets_at = (raw.get("resets_at") or 0) * 1000
    expired = resets_at > 0 and now >= resets_at
    return {
        "pct": 0 if expired else max(0, min(100, round(raw["used_percentage"]))),
        "resets_at": resets_at,
        "remain_min": max(0, round((resets_at - now) / 60000)) if resets_at else None,
        "expired": expired,
    }


def read() -> dict[str, Any] | None:
    try:
        stat = SNAPSHOT.stat()
        payload = json.loads(SNAPSHOT.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None

    limits = payload.get("rate_limits")
    if not limits:
        return None

    now = time.time() * 1000
    return {
        "age_ms": now - stat.st_mtime * 1000,
        "five_hour": _window(limits.get("five_hour"), now),
        "seven_day": _window(limits.get("seven_day"), now),
        "raw": payload,
    }
