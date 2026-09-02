"""데이터 수집. 키가 필요로 하는 것만 모은다."""

from __future__ import annotations

from . import external, snapshot, usage
from .external import FEEDS, Collector
from .snapshot import read as read_snapshot
from .usage import Usage

# 키 이름 -> 필요한 소스
NEEDS_USAGE = {"today", "burn"}
NEEDS_FEED = {"mail": "mail", "cal": "cal", "jira": "jira",
              "mr": "mr", "build": "build"}

__all__ = ["Collector", "FEEDS", "Usage", "read_snapshot",
           "NEEDS_USAGE", "NEEDS_FEED", "collect_once",
           "external", "snapshot", "usage"]


def collect_once():
    """미리보기용. 모든 소스를 한 번씩 동기로 모은다."""
    from ..render import State

    counter = Usage()
    counter.refresh()

    values: dict[str, dict] = {}
    for name, (fn, _every) in FEEDS.items():
        try:
            values[name] = fn()
        except Exception:
            values[name] = None

    return State(snap=read_snapshot(), usage=counter,
                 feeds={k: v for k, v in values.items() if v})
