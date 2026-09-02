"""키를 눌렀을 때 할 일.

설정에는 구조를 그대로 담는다. 셸 문자열 하나로만 저장하면 조작 화면에서
되읽어 편집할 수가 없다.

    {"type": "app",   "value": "/Applications/Safari.app"}
    {"type": "url",   "value": "https://example.com"}
    {"type": "shell", "value": "say hello"}
    {"type": "media", "value": "volumeup"}

미디어 항목은 AppleScript 로 처리한다. 음량과 음소거는 시스템 전체에
확실히 먹는다. 재생 제어는 시스템 전역 미디어 키를 AppleScript 로 보낼
방법이 없어서 실행 중인 음악 앱에 직접 지시한다.
"""

from __future__ import annotations

import shlex

NONE = "none"
APP = "app"
URL = "url"
SHELL = "shell"
MEDIA = "media"

LABELS = {
    NONE: "없음",
    APP: "앱 실행",
    URL: "링크 열기",
    SHELL: "셸 명령",
    MEDIA: "미디어",
}

_VOLUME_STEP = 10

# 앱 참조를 변수로 두면 "next track" 같은 두 단어 명령이 컴파일 시점에
# 해석되지 않는다. run script 로 실행 시점까지 미룬다.
_PLAYER_TEMPLATE = """
tell application "System Events" to set running_apps to name of every process
if "Spotify" is in running_apps then
    run script "tell application \\"Spotify\\" to {verb}"
else if "Music" is in running_apps then
    run script "tell application \\"Music\\" to {verb}"
end if
"""

# AppleScript 에는 min, max 연산자가 없다. 조건문으로 자른다.
def _volume(delta: int) -> str:
    bound = "if v > 100 then set v to 100" if delta > 0 else "if v < 0 then set v to 0"
    return (f"set v to (output volume of (get volume settings)) + {delta}\n"
            f"{bound}\n"
            f"set volume output volume v")


_MEDIA: dict[str, tuple[str, str]] = {
    "playpause": ("재생 / 일시정지", _PLAYER_TEMPLATE.format(verb="playpause")),
    "next": ("다음 트랙", _PLAYER_TEMPLATE.format(verb="next track")),
    "previous": ("이전 트랙", _PLAYER_TEMPLATE.format(verb="previous track")),
    "volumeup": ("음량 올리기", _volume(_VOLUME_STEP)),
    "volumedown": ("음량 내리기", _volume(-_VOLUME_STEP)),
    "mute": ("음소거 전환",
             "set volume output muted (not (output muted of (get volume settings)))"),
}

MEDIA_CHOICES = [(key, label) for key, (label, _script) in _MEDIA.items()]


def normalize(raw) -> dict:
    """예전 형식(셸 문자열)도 받아 준다."""
    if isinstance(raw, str):
        return {"type": SHELL, "value": raw} if raw else {"type": NONE, "value": ""}
    if isinstance(raw, dict) and raw.get("type") in LABELS:
        return {"type": raw["type"], "value": str(raw.get("value", ""))}
    return {"type": NONE, "value": ""}


def to_command(action) -> str | None:
    """실행할 셸 한 줄. 할 일이 없으면 None."""
    action = normalize(action)
    kind, value = action["type"], action["value"].strip()
    if kind == NONE or not value:
        return None
    if kind == APP:
        return f"open -a {shlex.quote(value)}"
    if kind == URL:
        return f"open {shlex.quote(value)}"
    if kind == SHELL:
        return value
    if kind == MEDIA:
        entry = _MEDIA.get(value)
        return f"osascript -e {shlex.quote(entry[1])}" if entry else None
    return None


def describe(action) -> str:
    action = normalize(action)
    kind, value = action["type"], action["value"]
    if kind == NONE or not value:
        return "없음"
    if kind == MEDIA:
        entry = _MEDIA.get(value)
        return f"미디어: {entry[0] if entry else value}"
    return f"{LABELS[kind]}: {value}"
