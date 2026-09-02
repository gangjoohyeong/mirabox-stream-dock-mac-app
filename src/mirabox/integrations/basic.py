"""외부 데이터가 필요 없는 기본 키.

이미지, 글자, 시계. 벤더 앱에서 앱 실행 버튼이나 라벨로 쓰던 자리를 이걸로
채운다. 소스를 요구하지 않으므로 아무것도 수집하지 않는다.
"""

from __future__ import annotations

from datetime import datetime

from PIL import Image, ImageDraw

from ..core.device import key_size
from ..core.registry import Option, key
from ..core.render import (BG, INK, MUTED, blank, card, font)

_cache: dict[tuple[str, float, int, int], Image.Image] = {}


def _load_cover(path: str, size: tuple[int, int]) -> Image.Image | None:
    """키를 꽉 채우도록 잘라 넣는다. 파일이 바뀌면 다시 읽는다."""
    try:
        import os
        stamp = os.path.getmtime(path)
    except OSError:
        return None

    token = (path, stamp, *size)
    hit = _cache.get(token)
    if hit is not None:
        return hit.copy()

    try:
        source = Image.open(path)
        source.load()
    except Exception:
        return None

    source = source.convert("RGB")
    target_w, target_h = size
    scale = max(target_w / source.width, target_h / source.height)
    resized = source.resize((max(1, round(source.width * scale)),
                             max(1, round(source.height * scale))), Image.LANCZOS)
    left = (resized.width - target_w) // 2
    top = (resized.height - target_h) // 2
    cropped = resized.crop((left, top, left + target_w, top + target_h))

    _cache.clear()                      # 키마다 한 장이면 충분하다
    _cache[token] = cropped
    return cropped.copy()


@key("image", "IMG", "그림 파일을 키에 채운다",
     options=(Option("path", "파일", kind="file", placeholder="/경로/아이콘.png"),
              Option("caption", "글자", placeholder="아래에 덧붙일 짧은 글자")))
def _image(index, state, options):
    size = key_size(index)
    picture = _load_cover(str(options.get("path", "")), size)
    if picture is None:
        return blank(index, "IMG", "없음")

    caption = str(options.get("caption", "")).strip()
    if caption:
        draw = ImageDraw.Draw(picture)
        band = round(size[1] * 0.28)
        draw.rectangle([0, size[1] - band, size[0], size[1]], fill=(0, 0, 0))
        size_pt = round(band * 0.62)
        text = caption[:8]
        draw.text((size[0] // 2, size[1] - band // 2), text,
                  font=font(size_pt, text), fill=INK, anchor="mm")
    return picture


@key("text", "TXT", "원하는 글자를 크게 보여준다",
     options=(Option("title", "위쪽 작은 글자", placeholder="예: 회의"),
              Option("value", "가운데 큰 글자", placeholder="예: 시작")))
def _text(index, state, options):
    return card(index,
                label=str(options.get("title", ""))[:8],
                value=str(options.get("value", ""))[:6] or "—")


@key("clock", "CLOCK", "현재 시각")
def _clock(index, state, options):
    now = datetime.now()
    return card(index, label=now.strftime("%m/%d"),
                value=now.strftime("%H:%M"), value_color=INK)


@key("blank", "BLANK", "아무것도 표시하지 않는다")
def _blank(index, state, options):
    return Image.new("RGB", key_size(index), BG)
