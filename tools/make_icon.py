#!/usr/bin/env python3
"""앱 아이콘(.icns)을 만든다.

기기를 그대로 옮긴 그림이다. 어두운 판에 키가 놓인 모양이고, 액센트는 하나만
쓴다. macOS 아이콘 규격대로 여러 크기를 뽑아 iconutil 로 묶는다.
"""

from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw

BG = (16, 19, 24)
TILE = (32, 36, 43)
ACCENT = (240, 138, 75)
OK = (69, 179, 122)

# macOS 아이콘은 캔버스 가장자리에 여백을 둔다
MARGIN_RATIO = 0.10
BASE = 1024


def draw(size: int) -> Image.Image:
    scale = size / BASE
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    pad = size * MARGIN_RATIO
    body = [pad, pad, size - pad, size - pad]
    d.rounded_rectangle(body, radius=size * 0.20, fill=BG)

    # 3열 2행. 실제 기기는 6열이지만 작은 크기에서 뭉개진다.
    cols, rows = 3, 2
    inner = size - pad * 2
    gap = inner * 0.055
    box = inner * 0.13
    grid_w = cols * box + (cols - 1) * gap
    grid_h = rows * box + (rows - 1) * gap
    x0 = pad + (inner - grid_w) / 2
    y0 = pad + (inner - grid_h) / 2

    for row in range(rows):
        for col in range(cols):
            x = x0 + col * (box + gap)
            y = y0 + row * (box + gap)
            fill = TILE
            if (row, col) == (0, 0):
                fill = ACCENT
            elif (row, col) == (1, 2):
                fill = OK
            d.rounded_rectangle([x, y, x + box, y + box],
                                radius=box * 0.24, fill=fill)
    return img


def build(out: Path) -> Path:
    iconset = out.with_suffix(".iconset")
    if iconset.exists():
        shutil.rmtree(iconset)
    iconset.mkdir(parents=True)

    for point in (16, 32, 64, 128, 256, 512):
        for scale in (1, 2):
            pixels = point * scale
            name = f"icon_{point}x{point}{'@2x' if scale == 2 else ''}.png"
            draw(pixels).save(iconset / name)

    subprocess.run(["iconutil", "-c", "icns", str(iconset), "-o", str(out)], check=True)
    shutil.rmtree(iconset)
    return out


if __name__ == "__main__":
    target = Path(sys.argv[1] if len(sys.argv) > 1 else "packaging/StreamDock.icns")
    target.parent.mkdir(parents=True, exist_ok=True)
    path = build(target)
    print(f"{path} ({path.stat().st_size:,} 바이트)")
