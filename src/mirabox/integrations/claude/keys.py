"""Claude Code 연동.

두 갈래에서 값을 얻는다.

    statusLine 스냅샷   계정 한도, 컨텍스트, 비용, 캐시 적중률
    로컬 jsonl          오늘 토큰, 현재 블록 소모 속도

계정 한도는 statusLine 훅에서만 나온다. `/usage` 를 비대화형으로 불러도
세션 요약만 나오고 한도는 없다. 훅 payload 에 rate_limits 가 들어오는 것은
Claude Code 2.1.80 부터다. ~/.claude/statusline-capture.sh 가 그 payload 를
파일로 떨궈두면 여기서 읽는다.

컨텍스트와 비용과 캐시는 계정 전역이 아니라 세션별 값이다. 여러 세션이
돌면 마지막에 상태줄을 갱신한 세션 것이 잡힌다.
"""

from __future__ import annotations

from ...core.registry import key, source
from ...core.render import (INK, blank, card, fmt4, limit_card, tone_down,
                            tone_up)
from . import snapshot as snapshot_module
from .usage import Usage

SNAPSHOT = "claude.snapshot"
USAGE = "claude.usage"

_counter = Usage()


@source(SNAPSHOT, every=5)
def _read_snapshot():
    return snapshot_module.read()


@source(USAGE, every=15)
def _read_usage():
    """jsonl 은 증분으로 읽는다. 전량은 1GB 를 넘는다."""
    _counter.refresh()
    return {"today": _counter.today(), "block": _counter.block()}


def _raw(state, field: str) -> dict:
    return ((state.get(SNAPSHOT) or {}).get("raw") or {}).get(field) or {}


@key("five", "5H", "계정 5시간 한도 사용률", sources=(SNAPSHOT,))
def _five(index, state):
    snap = state.get(SNAPSHOT) or {}
    return limit_card(index, "5H", snap.get("five_hour"),
                      snap.get("age_ms", float("inf")))


@key("seven", "7D", "계정 7일 한도 사용률", sources=(SNAPSHOT,))
def _seven(index, state):
    snap = state.get(SNAPSHOT) or {}
    return limit_card(index, "7D", snap.get("seven_day"),
                      snap.get("age_ms", float("inf")))


@key("ctx", "CTX", "최근 활동 세션의 컨텍스트 사용률", sources=(SNAPSHOT,))
def _ctx(index, state):
    window = _raw(state, "context_window")
    pct = window.get("used_percentage")
    if pct is None:
        return blank(index, "CTX")
    pct = max(0, min(100, round(pct)))
    return card(index, label="CTX", value=f"{pct}%", value_color=tone_up(pct),
                right=fmt4(window.get("context_window_size", 0)),
                band_pct=pct, band_color=tone_up(pct))


@key("cost", "COST", "최근 활동 세션의 누적 비용", sources=(SNAPSHOT,))
def _cost(index, state):
    cost = _raw(state, "cost")
    usd = cost.get("total_cost_usd")
    if usd is None:
        return blank(index, "COST")
    hours = round(cost.get("total_duration_ms", 0) / 3_600_000)
    return card(index, label="COST", value=f"${round(usd)}",
                right=f"{hours}h" if hours else None)


@key("cache", "CACHE", "프롬프트 캐시 적중률", sources=(SNAPSHOT,))
def _cache(index, state):
    cache = _raw(state, "prompt_cache")
    ratio = cache.get("hit_ratio")
    if ratio is None:
        return blank(index, "CACHE")
    pct = round(ratio * 100)
    return card(index, label="CACHE", value=f"{pct}%", value_color=tone_down(pct),
                band_pct=pct, band_color=tone_down(pct))


@key("today", "TODAY", "오늘 누적 토큰", sources=(USAGE,))
def _today(index, state):
    today = (state.get(USAGE) or {}).get("today")
    if not today:
        return blank(index, "TODAY")
    return card(index, label="TODAY", value=fmt4(today["tok"]),
                right=str(today["msgs"]), value_color=INK)


@key("burn", "BURN", "현재 블록의 분당 토큰 소모", sources=(USAGE,))
def _burn(index, state):
    block = (state.get(USAGE) or {}).get("block")
    if not block or not block["elapsed_min"]:
        return blank(index, "BURN")
    return card(index, label="BURN",
                value=fmt4(block["tok"] / block["elapsed_min"]),
                right=str(block["msgs"]), value_color=INK)
