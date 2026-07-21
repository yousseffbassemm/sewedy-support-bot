"""
Generate the dark-surface Elsewedy logo from the light one.

    python tools/make_dark_logo.py

Needs Pillow, which is deliberately NOT a project dependency -- this is a
one-off asset step, and the backend image should not carry an imaging library
it never imports. Run it with any Python that has Pillow (`pip install pillow`).
The committed logo-dark.png is the output, so you only need this to regenerate
after the source logo changes.

Reads  supportbot-ui/public/logo.png   (black wordmark + red arc, transparent bg)
Writes supportbot-ui/public/logo-dark.png (white wordmark + the SAME red arc)

Why an asset instead of a CSS filter
------------------------------------
Every filter that lightens the wordmark also wrecks the arc:

  brightness(0) invert(1)   crushes all pixels to black, then whitens them --
                            the red arc comes out white. This was the bug.
  invert(1) hue-rotate(180) keeps a red-ish arc, but hue-rotate is a matrix
                            approximation, so the arc lands off-brand.

Splitting the image by chroma keeps the arc bit-exact.

Two details that matter
-----------------------
1. Achromatic pixels are inverted on *luminance* and written back as neutral
   grey, not inverted per channel. The source wordmark carries a faint magenta
   cast; per-channel inversion turned it visibly green.
2. The chroma test is a channel-spread threshold, so the semi-transparent
   antialiased pixels along the edge of the arc are still recognised as red and
   pass through untouched. That keeps the arc's edge smooth rather than fringed.
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
# supportbot-ui now lives INSIDE the repo. It used to sit alongside it, which
# is why this was ROOT.parent -- a path that only resolved on the one machine
# where the checkout happened to have the UI as its sibling.
PUBLIC = ROOT / "supportbot-ui" / "public"
SRC = PUBLIC / "logo.png"
DST = PUBLIC / "logo-dark.png"

# How much redder than the other channels a pixel must be to count as "the arc".
CHROMA_THRESHOLD = 35


def is_brand_red(r: int, g: int, b: int) -> bool:
    return r > g + CHROMA_THRESHOLD and r > b + CHROMA_THRESHOLD


def main() -> None:
    if not SRC.exists():
        raise SystemExit(f"source logo not found: {SRC}")

    im = Image.open(SRC).convert("RGBA")
    w, h = im.size
    src = im.load()
    out = Image.new("RGBA", (w, h))
    dst = out.load()

    kept = flipped = 0
    for y in range(h):
        for x in range(w):
            r, g, b, a = src[x, y]
            if a == 0:
                dst[x, y] = (0, 0, 0, 0)
            elif is_brand_red(r, g, b):
                dst[x, y] = (r, g, b, a)  # arc preserved exactly
                kept += 1
            else:
                lum = int(0.2126 * r + 0.7152 * g + 0.0722 * b)
                v = 255 - lum
                dst[x, y] = (v, v, v, a)
                flipped += 1

    out.save(DST)
    print(f"wrote {DST}")
    print(f"  arc pixels preserved : {kept}")
    print(f"  wordmark pixels flipped: {flipped}")


if __name__ == "__main__":
    main()
