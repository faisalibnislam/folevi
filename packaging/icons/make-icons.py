#!/usr/bin/env python3
"""Folevi Server package icons, made from the Folevi app icon (apps/web/public/icons/icon-512.png).

Writes folevi-<size>.png, folevi-64-gray.png (QNAP's stopped state) and the QNAP GIFs. Every NAS shows the same
icon people know from the apps. The PNGs are committed, so builds need no image tools.
Run: uv run --with pillow python3 packaging/icons/make-icons.py
"""
import os
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
SOURCE = os.path.join(HERE, "..", "..", "apps", "web", "public", "icons", "icon-512.png")
SIZES = [16, 24, 32, 48, 64, 72, 90, 120, 128, 144, 256, 512]


def main() -> None:
    src = Image.open(SOURCE).convert("RGBA")
    for size in SIZES:
        src.resize((size, size), Image.LANCZOS).save(os.path.join(HERE, f"folevi-{size}.png"), optimize=True)
    icon64 = src.resize((64, 64), Image.LANCZOS)
    gray = icon64.convert("LA").convert("RGBA")
    gray.putalpha(icon64.getchannel("A").point(lambda a: a * 6 // 10))
    gray.save(os.path.join(HERE, "folevi-64-gray.png"), optimize=True)
    # QNAP wants GIFs: 64 (running), 64 gray (stopped), 80 (App Center).
    for name, img in (("folevi-qnap-64.gif", icon64), ("folevi-qnap-64-gray.gif", gray), ("folevi-qnap-80.gif", src.resize((80, 80), Image.LANCZOS))):
        flat = Image.new("RGBA", img.size, (255, 255, 255, 0))
        flat.alpha_composite(img)
        flat.convert("P", palette=Image.ADAPTIVE).save(os.path.join(HERE, name), transparency=0)
    stale = os.path.join(HERE, "folevi.svg")
    if os.path.exists(stale):
        os.remove(stale)


if __name__ == "__main__":
    main()
