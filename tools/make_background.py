#!/usr/bin/env python3
"""Draw the still parts of the demo video (title and captions) into one 1920x1080 PNG.

    make_background.py <out.png> <title> <subtitle> <left caption> <right caption> <footer>

Needs Pillow. The moving parts (footage, terminal) are laid over it by make_demo.sh.
"""
import sys
from PIL import Image, ImageDraw, ImageFont

FONTS = ["/System/Library/Fonts/Helvetica.ttc", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"]


def font(size):
    for f in FONTS:
        try:
            return ImageFont.truetype(f, size)
        except OSError:
            continue
    return ImageFont.load_default()


def wrap(draw, text, fnt, width):
    lines, line = [], ""
    for word in text.split():
        trial = (line + " " + word).strip()
        if draw.textlength(trial, font=fnt) > width and line:
            lines.append(line)
            line = word
        else:
            line = trial
    if line:
        lines.append(line)
    return lines


def block(draw, xy, text, fnt, width, fill, gap=8):
    x, y = xy
    for ln in wrap(draw, text, fnt, width):
        draw.text((x, y), ln, font=fnt, fill=fill)
        y += fnt.size + gap
    return y


def main():
    out, title, subtitle, left, right, footer = sys.argv[1:7]
    img = Image.new("RGB", (1920, 1080), (20, 22, 27))
    d = ImageDraw.Draw(img)
    d.text((70, 52), title, font=font(44), fill=(255, 255, 255))
    d.text((70, 108), subtitle, font=font(28), fill=(170, 176, 188))
    block(d, (70, 800), left, font(24), 720, (184, 188, 198))
    block(d, (820, 800), right, font(24), 1030, (184, 188, 198))
    d.text((70, 1020), footer, font=font(24), fill=(120, 200, 220))
    img.save(out)
    print("wrote", out)


if __name__ == "__main__":
    main()
