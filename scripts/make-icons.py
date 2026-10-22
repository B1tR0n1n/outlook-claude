"""Render the add-in icons: a gold C on the b1tr0n1n background, at every size Outlook asks for."""
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

BG, GOLD, BORDER = "#0a0908", "#c9a227", "#2a2520"
SIZES = (16, 32, 64, 80, 128)
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf"


def render(size: int) -> Image.Image:
    scale = 8  # draw large, downsample for clean edges
    s = size * scale
    img = Image.new("RGB", (s, s), BG)
    d = ImageDraw.Draw(img)
    w = max(scale, s // 16)
    d.rectangle([0, 0, s - 1, s - 1], outline=GOLD if size >= 32 else BORDER, width=w)
    font = ImageFont.truetype(FONT, int(s * 0.72))
    box = d.textbbox((0, 0), "C", font=font)
    x = (s - (box[2] - box[0])) / 2 - box[0]
    y = (s - (box[3] - box[1])) / 2 - box[1]
    d.text((x, y), "C", font=font, fill=GOLD)
    return img.resize((size, size), Image.LANCZOS)


def main(out_dir: str) -> None:
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    for size in SIZES:
        render(size).save(out / f"icon-{size}.png")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "assets")
