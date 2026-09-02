"""Jira 연동. 사내 읽기 전용 CLI 를 쓴다. 자격증명은 ~/.config 에 있다."""

from __future__ import annotations

from ..core.registry import key, source
from ..core.render import DANGER, OK, blank, card
from ..core.shell import json_after_noise, run

JIRA_TODAY = "jira.today"


@source(JIRA_TODAY, every=300)
def _fetch_today():
    data = json_after_noise(run("jira today 2>/dev/null", 25))
    if data is None:
        raise RuntimeError("jira 응답을 파싱하지 못했다")
    return {"items": len(data.get("items") or [])}


@key("jira", "JIRA", "오늘 Jira 에 기록한 항목 수", sources=(JIRA_TODAY,))
def _jira(index, state):
    value = state.get(JIRA_TODAY)
    if not value:
        return blank(index, "JIRA")
    # 0 이면 일일업무 미등록이다. 이 키의 존재 이유가 그 경고다.
    color = DANGER if value["items"] == 0 else OK
    return card(index, label="JIRA", value=str(value["items"]), value_color=color,
                right="todo" if value["items"] == 0 else "done",
                right_color=color, band_color=color)
