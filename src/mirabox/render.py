"""키 면을 그린다.

모든 키가 같은 골격을 쓴다.

    상단 행    라벨(왼쪽) 과 보조값(오른쪽)
    주 수치    가운데. 네 글자를 넘기지 않는다
    하단 띠    비율이 있으면 게이지, 없으면 상태색 단색

기기 키는 95x95 이고 오른쪽 끝 열만 82x82 다. 벤더 앱은 126x126 을 받아
축소했지만 여기서는 네이티브 크기로 직접 그린다. 축소가 없어 더 선명하다.
치수는 126 기준 설계를 0.754 배 한 값이다.

판독 기준은 화면이 아니라 실물이다. 책상 거리에서 읽히지 않으면 실패다.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable

from PIL import Image, ImageDraw, ImageFont

from .device import KEY_SIZE, SIDE_SIZE, key_size

FONT_PATH = "/System/Library/Fonts/Supplemental/HelveticaNeue.ttc"
CONDENSED_BOLD = 4

BG = (16, 19, 24)
INK = (255, 255, 255)
MUTED = (154, 163, 175)
DIM = (92, 100, 112)
SIGNAL = (240, 138, 75)
TRACK = (46, 52, 61)
OK = (69, 179, 122)
DANGER = (228, 91, 78)

PAD = 8
TOP_BASELINE = 26
VALUE_BASELINE = 72
BAND_Y = 80
BAND_H = 9

_fonts: dict[int, ImageFont.FreeTypeFont] = {}


def font(size: int) -> ImageFont.FreeTypeFont:
    if size not in _fonts:
        _fonts[size] = ImageFont.truetype(FONT_PATH, size, index=CONDENSED_BOLD)
    return _fonts[size]


TOP_SIZE = 23
VALUE_SIZE = 35
SMALL_SIZE = 17


# ---------- 값 표기 ----------

def fmt4(n: float) -> str:
    """최대 네 글자. 글자 수를 줄여야 폰트를 키울 수 있다."""
    n = float(n)
    if n >= 1e9:
        return f"{n / 1e9:.1f}B"
    if n >= 1e7:
        return f"{round(n / 1e6)}M"
    if n >= 1e6:
        return f"{n / 1e6:.1f}M"
    if n >= 1e3:
        return f"{round(n / 1e3)}K"
    return str(round(n))


def hhmm(minutes: int) -> str:
    return f"{minutes // 60}:{minutes % 60:02d}"


def remain_text(minutes: int) -> str:
    """하루를 넘으면 분 단위가 의미 없다."""
    return f"{round(minutes / 60)}h" if minutes >= 24 * 60 else hhmm(minutes)


def tone_up(pct: float) -> tuple[int, int, int]:
    """한도형. 높을수록 나쁘다."""
    return DANGER if pct >= 85 else SIGNAL if pct >= 60 else OK


def tone_down(pct: float) -> tuple[int, int, int]:
    """적중률처럼 높을수록 좋은 값."""
    return OK if pct >= 85 else SIGNAL if pct >= 60 else DANGER


# ---------- 골격 ----------

def _text_width(draw: ImageDraw.ImageDraw, text: str, size: int) -> int:
    x0, _, x1, _ = draw.textbbox((0, 0), text, font=font(size))
    return x1 - x0


def card(key: int, *, label: str, value: str,
         right: str | None = None,
         right_color: tuple[int, int, int] = MUTED,
         value_color: tuple[int, int, int] = INK,
         band_pct: float | None = None,
         band_color: tuple[int, int, int] = TRACK) -> Image.Image:
    w, h = key_size(key)
    scale = w / KEY_SIZE[0]          # 사이드 키는 조금 작다
    px = round(PAD * scale)
    img = Image.new("RGB", (w, h), BG)
    d = ImageDraw.Draw(img)

    top_size = max(10, round(TOP_SIZE * scale))
    d.text((px, round(TOP_BASELINE * scale)), label, font=font(top_size),
           fill=MUTED, anchor="ls")

    # 라벨이 길면 보조값과 겹친다. 폭을 재서 줄이고, 그래도 안 되면 버린다.
    if right:
        avail = w - 2 * px - _text_width(d, label, top_size) - round(5 * scale)
        for size in (top_size, max(9, round(SMALL_SIZE * scale))):
            if _text_width(d, right, size) <= avail:
                d.text((w - px, round(TOP_BASELINE * scale)), right,
                       font=font(size), fill=right_color, anchor="rs")
                break

    # 주 수치가 폭을 넘으면 한 단계 줄인다
    value_size = round(VALUE_SIZE * scale)
    while value_size > 12 and _text_width(d, value, value_size) > w - 2 * px:
        value_size -= 1
    d.text((px, round(VALUE_BASELINE * scale)), value, font=font(value_size),
           fill=value_color, anchor="ls")

    by, bh = round(BAND_Y * scale), max(4, round(BAND_H * scale))
    bw = w - 2 * px
    d.rounded_rectangle([px, by, px + bw, by + bh], bh // 2, fill=TRACK)
    if band_pct is not None:
        fill_w = max(bh, round(bw * min(100.0, max(0.0, band_pct)) / 100))
        d.rounded_rectangle([px, by, px + fill_w, by + bh], bh // 2, fill=band_color)
    elif band_color != TRACK:
        d.rounded_rectangle([px, by, px + bw, by + bh], bh // 2, fill=band_color)
    return img


def blank(key: int, label: str, note: str = "--") -> Image.Image:
    return card(key, label=label, value=note, value_color=DIM)


# ---------- 상태 ----------

@dataclass
class State:
    """키를 그리는 데 필요한 것들. daemon 이 채운다."""
    snap: dict[str, Any] | None = None      # Claude statusLine 스냅샷
    usage: Any = None                       # jsonl 집계기
    feeds: dict[str, Any] = field(default_factory=dict)   # 외부 수집 결과


STALE_MS = 30 * 60_000


def _limit(key: int, label: str, win: dict | None, age_ms: float) -> Image.Image:
    if not win:
        return blank(key, label)
    stale = age_ms > STALE_MS
    pct = win["pct"]
    color = DIM if stale else tone_up(pct)
    return card(key, label=label, value=f"{pct}%", value_color=color,
                right=None if win["remain_min"] is None else remain_text(win["remain_min"]),
                right_color=DIM if stale else MUTED,
                band_pct=pct, band_color=color)


# ---------- 키 12종 ----------

def _five(key, s):
    snap = s.snap or {}
    return _limit(key, "5H", snap.get("five_hour"), snap.get("age_ms", float("inf")))


def _seven(key, s):
    snap = s.snap or {}
    return _limit(key, "7D", snap.get("seven_day"), snap.get("age_ms", float("inf")))


def _ctx(key, s):
    cw = ((s.snap or {}).get("raw") or {}).get("context_window") or {}
    pct = cw.get("used_percentage")
    if pct is None:
        return blank(key, "CTX")
    pct = max(0, min(100, round(pct)))
    return card(key, label="CTX", value=f"{pct}%", value_color=tone_up(pct),
                right=fmt4(cw.get("context_window_size", 0)),
                band_pct=pct, band_color=tone_up(pct))


def _cost(key, s):
    co = ((s.snap or {}).get("raw") or {}).get("cost") or {}
    usd = co.get("total_cost_usd")
    if usd is None:
        return blank(key, "COST")
    hours = round(co.get("total_duration_ms", 0) / 3_600_000)
    return card(key, label="COST", value=f"${round(usd)}",
                right=f"{hours}h" if hours else None)


def _cache(key, s):
    pc = ((s.snap or {}).get("raw") or {}).get("prompt_cache") or {}
    ratio = pc.get("hit_ratio")
    if ratio is None:
        return blank(key, "CACHE")
    pct = round(ratio * 100)
    return card(key, label="CACHE", value=f"{pct}%", value_color=tone_down(pct),
                band_pct=pct, band_color=tone_down(pct))


def _today(key, s):
    d = s.usage.today() if s.usage else None
    if not d:
        return blank(key, "TODAY")
    return card(key, label="TODAY", value=fmt4(d["tok"]), right=str(d["msgs"]))


def _burn(key, s):
    b = s.usage.block() if s.usage else None
    if not b or not b["elapsed_min"]:
        return blank(key, "BURN")
    return card(key, label="BURN", value=fmt4(b["tok"] / b["elapsed_min"]),
                right=str(b["msgs"]))


def _mail(key, s):
    v = s.feeds.get("mail")
    if not v:
        return blank(key, "MAIL")
    unread = v["unread"]
    color = OK if unread == 0 else (DANGER if unread >= 100 else SIGNAL)
    return card(key, label="MAIL", value=str(unread), value_color=color,
                right=str(v["threads"]), band_color=color)


def _cal(key, s):
    v = s.feeds.get("cal")
    if not v:
        return blank(key, "CAL")
    if v["in_min"] is None:
        return card(key, label="CAL", value="none", value_color=DIM)
    color = DANGER if v["in_min"] <= 15 else (SIGNAL if v["in_min"] <= 60 else OK)
    return card(key, label="CAL", value=remain_text(v["in_min"]),
                value_color=color, band_color=color)


def _jira(key, s):
    v = s.feeds.get("jira")
    if not v:
        return blank(key, "JIRA")
    color = DANGER if v["items"] == 0 else OK
    return card(key, label="JIRA", value=str(v["items"]), value_color=color,
                right="todo" if v["items"] == 0 else "done", right_color=color,
                band_color=color)


def _mr(key, s):
    v = s.feeds.get("mr")
    if not v:
        return blank(key, "MR")
    color = OK if v["count"] == 0 else SIGNAL
    return card(key, label="MR", value=str(v["count"]), value_color=color,
                band_color=color)


def _build(key, s):
    v = s.feeds.get("build")
    if not v:
        return blank(key, "BUILD")
    ratio = v["load"] / v["cores"] if v["cores"] else 0
    color = DANGER if ratio >= 0.9 else (SIGNAL if ratio >= 0.5 else OK)
    load = f"{v['load']:.1f}" if v["load"] < 10 else str(round(v["load"]))
    return card(key, label="BUILD", value=load, value_color=color,
                right=f"{v['diskPct']}%" if v.get("diskPct") else None,
                right_color=DANGER if v.get("diskPct", 0) >= 85 else MUTED,
                band_pct=ratio * 100, band_color=color)


KEYS: dict[str, Callable[[int, State], Image.Image]] = {
    "five": _five, "seven": _seven, "ctx": _ctx, "cost": _cost, "cache": _cache,
    "today": _today, "burn": _burn,
    "mail": _mail, "cal": _cal, "jira": _jira, "mr": _mr, "build": _build,
}


def render(name: str, key: int, state: State) -> Image.Image:
    fn = KEYS.get(name)
    if fn is None:
        return blank(key, name.upper()[:5], "?")
    try:
        return fn(key, state)
    except Exception:
        return blank(key, name.upper()[:5], "err")


def _preview(out_dir: str = "/tmp/mirabox-keys") -> None:
    """기기 없이 렌더링을 눈으로 확인한다. 실제 크기와 4배를 함께 만든다."""
    import os
    from .sources import collect_once

    os.makedirs(out_dir, exist_ok=True)
    state = collect_once()
    names = list(KEYS)
    tiles = []
    for i, name in enumerate(names):
        img = render(name, i, state)
        img.save(os.path.join(out_dir, f"{name}.png"))
        tiles.append(img)

    cols, gap, scale = 6, 6, 4
    w, h = KEY_SIZE
    rows = (len(tiles) + cols - 1) // cols
    sheet = Image.new("RGB", (gap + cols * (w * scale + gap),
                              gap + rows * (h * scale + gap)), (24, 26, 30))
    for i, img in enumerate(tiles):
        big = img.resize((w * scale, h * scale), Image.NEAREST)
        sheet.paste(big, (gap + (i % cols) * (w * scale + gap),
                          gap + (i // cols) * (h * scale + gap)))
    sheet.save(os.path.join(out_dir, "sheet.png"))

    strip = Image.new("RGB", (gap + len(tiles) * (w + gap), h + 2 * gap), (24, 26, 30))
    for i, img in enumerate(tiles):
        strip.paste(img, (gap + i * (w + gap), gap))
    strip.save(os.path.join(out_dir, "actual-size.png"))
    print(f"{len(tiles)}종 렌더링 -> {out_dir}")


if __name__ == "__main__":
    _preview()
