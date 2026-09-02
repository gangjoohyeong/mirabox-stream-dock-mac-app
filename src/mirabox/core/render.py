"""키 카드의 공통 골격.

여기에는 그리는 방법만 있다. 무엇을 그릴지는 integrations 가 정한다.

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

from PIL import Image, ImageDraw, ImageFont

from .device import KEY_SIZE, key_size

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

TOP_SIZE = 23
VALUE_SIZE = 35
SMALL_SIZE = 17

_fonts: dict[int, ImageFont.FreeTypeFont] = {}


def font(size: int) -> ImageFont.FreeTypeFont:
    if size not in _fonts:
        _fonts[size] = ImageFont.truetype(FONT_PATH, size, index=CONDENSED_BOLD)
    return _fonts[size]


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


def tone_up(pct: float):
    """한도형. 높을수록 나쁘다."""
    return DANGER if pct >= 85 else SIGNAL if pct >= 60 else OK


def tone_down(pct: float):
    """적중률처럼 높을수록 좋은 값."""
    return OK if pct >= 85 else SIGNAL if pct >= 60 else DANGER


# ---------- 골격 ----------

def _width(draw: ImageDraw.ImageDraw, text: str, size: int) -> int:
    x0, _, x1, _ = draw.textbbox((0, 0), text, font=font(size))
    return x1 - x0


def card(key: int, *, label: str, value: str,
         right: str | None = None,
         right_color=MUTED,
         value_color=INK,
         band_pct: float | None = None,
         band_color=TRACK) -> Image.Image:
    w, h = key_size(key)
    scale = w / KEY_SIZE[0]              # 사이드 키는 조금 작다
    px = round(PAD * scale)
    img = Image.new("RGB", (w, h), BG)
    d = ImageDraw.Draw(img)

    top_size = max(10, round(TOP_SIZE * scale))
    baseline = round(TOP_BASELINE * scale)
    d.text((px, baseline), label, font=font(top_size), fill=MUTED, anchor="ls")

    # 라벨이 길면 보조값과 겹친다. 폭을 재서 줄이고, 그래도 안 되면 버린다.
    if right:
        avail = w - 2 * px - _width(d, label, top_size) - round(5 * scale)
        for size in (top_size, max(9, round(SMALL_SIZE * scale))):
            if _width(d, right, size) <= avail:
                d.text((w - px, baseline), right, font=font(size),
                       fill=right_color, anchor="rs")
                break

    # 주 수치가 폭을 넘으면 한 단계씩 줄인다
    value_size = round(VALUE_SIZE * scale)
    while value_size > 12 and _width(d, value, value_size) > w - 2 * px:
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


def blank(key: int, label: str = "", note: str = "--") -> Image.Image:
    return card(key, label=label, value=note, value_color=DIM)


def limit_card(key: int, label: str, window: dict | None, age_ms: float,
               stale_ms: float = 30 * 60_000) -> Image.Image:
    """0..100 퍼센트에 남은 시간을 곁들이는, 한도형 지표의 공통 모양."""
    if not window:
        return blank(key, label)
    stale = age_ms > stale_ms
    pct = window["pct"]
    color = DIM if stale else tone_up(pct)
    remain = window.get("remain_min")
    return card(key, label=label, value=f"{pct}%", value_color=color,
                right=None if remain is None else remain_text(remain),
                right_color=DIM if stale else MUTED,
                band_pct=pct, band_color=color)
