"""사내 빌드 서버 연동. ssh 키 인증으로 붙는다."""

from __future__ import annotations

from ..core.registry import key, source
from ..core.render import DANGER, MUTED, OK, SIGNAL, blank, card
from ..core.shell import run

BUILD = "buildhost.load"

# 원격 명령은 로컬에서 작은따옴표로 감싸 넘긴다. 그래서 명령 안에는
# 작은따옴표도 $ 도 쓰면 안 된다. 둘 다 로컬 셸이 먼저 건드린다.
_REMOTE = ('cut -d" " -f1 /proc/loadavg; nproc; '
           'df -P / | tail -1 | tr -s " " | cut -d" " -f5')


@source(BUILD, every=300)
def _fetch_build():
    out = run("ssh -o BatchMode=yes -o ConnectTimeout=8 "
              f"-o StrictHostKeyChecking=accept-new sphere-build '{_REMOTE}' 2>/dev/null", 25)
    parts = out.strip().split("\n")
    if len(parts) < 3:
        raise RuntimeError("빌드 서버 응답이 짧다")
    return {"load": float(parts[0]), "cores": int(parts[1]),
            "disk_pct": int(parts[2].replace("%", ""))}


@key("build", "BUILD", "빌드 서버 부하와 디스크", sources=(BUILD,))
def _build(index, state, options):
    value = state.get(BUILD)
    if not value:
        return blank(index, "BUILD")
    ratio = value["load"] / value["cores"] if value["cores"] else 0
    color = DANGER if ratio >= 0.9 else (SIGNAL if ratio >= 0.5 else OK)
    load = value["load"]
    return card(index, label="BUILD",
                value=f"{load:.1f}" if load < 10 else str(round(load)),
                value_color=color,
                right=f"{value['disk_pct']}%" if value["disk_pct"] else None,
                right_color=DANGER if value["disk_pct"] >= 85 else MUTED,
                band_pct=ratio * 100, band_color=color)
