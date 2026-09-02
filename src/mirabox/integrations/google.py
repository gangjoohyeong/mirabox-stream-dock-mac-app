"""Google Workspace 연동.

gws CLI 를 통해 읽는다. 인증은 gws 가 OAuth 키링으로 들고 있다.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
import json

from ..core.registry import key, source
from ..core.render import DANGER, DIM, OK, SIGNAL, blank, card, remain_text
from ..core.shell import json_after_noise, run

MAIL = "google.mail"
CALENDAR = "google.calendar"


def _iso(when: datetime) -> str:
    return when.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


@source(MAIL, every=60)
def _fetch_mail():
    """라벨 한 번만 읽으면 되므로 가장 싸다."""
    data = json_after_noise(
        run("""gws gmail users labels get --params '{"userId":"me","id":"INBOX"}' 2>/dev/null""", 20))
    if not data:
        raise RuntimeError("gmail 응답을 파싱하지 못했다")
    return {"unread": data.get("messagesUnread", 0),
            "threads": data.get("threadsUnread", 0)}


@source(CALENDAR, every=60)
def _fetch_calendar():
    now = datetime.now(timezone.utc)
    params = json.dumps({
        "calendarId": "primary", "timeMin": _iso(now),
        "timeMax": _iso(now + timedelta(days=7)),
        "maxResults": 10, "singleEvents": True, "orderBy": "startTime",
    })
    data = json_after_noise(
        run(f"gws calendar events list --params '{params}' 2>/dev/null", 20))
    if data is None:
        raise RuntimeError("calendar 응답을 파싱하지 못했다")
    for item in data.get("items", []):
        start = (item.get("start") or {}).get("dateTime")
        if not start:
            continue                          # 종일 일정은 제외한다
        when = datetime.fromisoformat(start)
        if when > now:
            return {"in_min": round((when - now).total_seconds() / 60),
                    "title": item.get("summary", "")}
    return {"in_min": None, "title": ""}


@key("mail", "MAIL", "안 읽은 메일 수", sources=(MAIL,))
def _mail(index, state, options):
    value = state.get(MAIL)
    if not value:
        return blank(index, "MAIL")
    unread = value["unread"]
    color = OK if unread == 0 else (DANGER if unread >= 100 else SIGNAL)
    return card(index, label="MAIL", value=str(unread), value_color=color,
                right=str(value["threads"]), band_color=color)


@key("cal", "CAL", "다음 일정까지 남은 시간", sources=(CALENDAR,))
def _cal(index, state, options):
    value = state.get(CALENDAR)
    if not value:
        return blank(index, "CAL")
    if value["in_min"] is None:
        return card(index, label="CAL", value="none", value_color=DIM)
    minutes = value["in_min"]
    color = DANGER if minutes <= 15 else (SIGNAL if minutes <= 60 else OK)
    return card(index, label="CAL", value=remain_text(minutes),
                value_color=color, band_color=color)
