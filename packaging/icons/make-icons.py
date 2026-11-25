#!/usr/bin/env python3
"""Placeholder Folevi Server icons.

Writes folevi.svg and folevi-<size>.png from the same simple geometry (a rounded green square with a white leaf
and a small server bar). These are PLACEHOLDERS: the owner must supply real artwork before any store submission.
Run: python3 packaging/icons/make-icons.py  (needs Pillow). The PNGs are committed so builds need no image tools.
"""
import os
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
SIZES = [16, 24, 32, 48, 64, 72, 90, 120, 128, 144, 256, 512]
BG = (31, 122, 90, 255)
FG = (255, 255, 255, 255)

SVG = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256">
  <!-- Placeholder artwork. Replace with the real Folevi Server icon before store submission. -->
  <rect x="8" y="8" width="240" height="240" rx="56" fill="#1f7a5a"/>
  <path d="M72 168 C72 104 120 64 188 60 C184 128 144 172 80 176 Z" fill="#ffffff"/>
  <rect x="64" y="196" width="128" height="16" rx="8" fill="#ffffff"/>
</svg>
"""

def draw(size):
    scale = 4
    s = size * scale
    k = s / 256.0
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([8 * k, 8 * k, 248 * k, 248 * k], radius=56 * k, fill=BG)
    # Leaf: approximate the SVG curves with a polygon from two quadratic-ish arcs.
    pts = []
    def bez(p0, p1, p2, p3, n=24):
        for i in range(n + 1):
            t = i / n
            x = (1-t)**3*p0[0] + 3*(1-t)**2*t*p1[0] + 3*(1-t)*t**2*p2[0] + t**3*p3[0]
            y = (1-t)**3*p0[1] + 3*(1-t)**2*t*p1[1] + 3*(1-t)*t**2*p2[1] + t**3*p3[1]
            pts.append((x * k, y * k))
    bez((72, 168), (72, 104), (120, 64), (188, 60))
    bez((188, 60), (184, 128), (144, 172), (80, 176))
    d.polygon(pts, fill=FG)
    d.rounded_rectangle([64 * k, 196 * k, 192 * k, 212 * k], radius=8 * k, fill=FG)
    return img.resize((size, size), Image.LANCZOS)

def main():
    with open(os.path.join(HERE, "folevi.svg"), "w") as f:
        f.write(SVG)
    for size in SIZES:
        draw(size).save(os.path.join(HERE, f"folevi-{size}.png"), optimize=True)
    # Greyed variant for QNAP's "disabled" icon.
    grey = draw(64).convert("LA").convert("RGBA")
    grey.save(os.path.join(HERE, "folevi-64-gray.png"), optimize=True)
    # QNAP App Center wants GIFs: 64x64, 80x80 and a grey 64x64.
    def gif(img, name):
        bg = Image.new("RGBA", img.size, (255, 255, 255, 0))
        bg.alpha_composite(img)
        bg.convert("RGB").convert("P", palette=Image.ADAPTIVE).save(os.path.join(HERE, name))
    gif(draw(64), "folevi-qnap-64.gif")
    gif(draw(80), "folevi-qnap-80.gif")
    gif(grey, "folevi-qnap-64-gray.gif")

if __name__ == "__main__":
    main()
