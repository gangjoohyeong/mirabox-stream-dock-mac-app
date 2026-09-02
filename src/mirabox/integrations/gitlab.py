"""사내 GitLab 연동. 토큰은 macOS 키체인에서 꺼낸다."""

from __future__ import annotations

import json

from ..core.registry import key, source
from ..core.render import OK, SIGNAL, blank, card
from ..core.shell import run

REVIEW_MRS = "gitlab.review_mrs"

_SCRIPT = """
T=$(security find-generic-password -s gitlab.wisenut.kr -a jkang -w 2>/dev/null) || exit 1
[ -n "$T" ] || exit 1
curl -s --max-time 20 -H "PRIVATE-TOKEN: $T" \
  "https://gitlab.wisenut.kr/api/v4/merge_requests?scope=all&reviewer_username=jkang&state=opened&per_page=100"
"""


@source(REVIEW_MRS, every=120)
def _fetch_mrs():
    try:
        rows = json.loads(run(_SCRIPT, 30))
    except ValueError as exc:
        raise RuntimeError("gitlab 응답을 파싱하지 못했다") from exc
    if not isinstance(rows, list):
        raise RuntimeError("gitlab 응답 형태가 다르다")
    return {"count": len(rows)}


@key("mr", "MR", "내 리뷰를 기다리는 MR 수", sources=(REVIEW_MRS,))
def _mr(index, state, options):
    value = state.get(REVIEW_MRS)
    if not value:
        return blank(index, "MR")
    color = OK if value["count"] == 0 else SIGNAL
    return card(index, label="MR", value=str(value["count"]),
                value_color=color, band_color=color)
