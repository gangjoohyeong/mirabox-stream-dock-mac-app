"""기기 없이 렌더링을 눈으로 확인한다.

좌표 계산만 믿으면 안 된다. 실제 크기와 확대본을 함께 만들어 본다.
실제 크기에서 읽히지 않으면 실패다.
"""

from __future__ import annotations

import os

from PIL import Image

from .. import integrations  # noqa: F401  소스와 키를 등록시킨다
from .daemon import Collector
from .device import KEY_SIZE
from .registry import KEYS, SOURCES
from .state import State

OUT_DIR = "/tmp/mirabox-keys"


def main(out_dir: str = OUT_DIR) -> None:
    os.makedirs(out_dir, exist_ok=True)

    values, errors = {}, {}
    for name, entry in SOURCES.items():
        try:
            values[name] = entry.fetch()
        except Exception as exc:
            errors[name] = f"{type(exc).__name__}: {exc}"
    state = State(data=values, errors=errors)
    for name, message in errors.items():
        print(f"  소스 실패 {name}: {message}")

    tiles = []
    for index, (name, entry) in enumerate(KEYS.items()):
        image = entry.render(index, state)
        image.save(os.path.join(out_dir, f"{name}.png"))
        tiles.append(image)

    cols, gap, scale = 6, 6, 4
    w, h = KEY_SIZE
    rows = (len(tiles) + cols - 1) // cols
    sheet = Image.new("RGB", (gap + cols * (w * scale + gap),
                              gap + rows * (h * scale + gap)), (24, 26, 30))
    strip = Image.new("RGB", (gap + len(tiles) * (w + gap), h + 2 * gap), (24, 26, 30))
    for i, image in enumerate(tiles):
        sheet.paste(image.resize((w * scale, h * scale), Image.NEAREST),
                    (gap + (i % cols) * (w * scale + gap),
                     gap + (i // cols) * (h * scale + gap)))
        strip.paste(image, (gap + i * (w + gap), gap))
    sheet.save(os.path.join(out_dir, "sheet.png"))
    strip.save(os.path.join(out_dir, "actual-size.png"))
    print(f"키 {len(tiles)}종 렌더링 -> {out_dir}")


if __name__ == "__main__":
    main()
