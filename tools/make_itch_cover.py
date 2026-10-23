"""Build the PocketFoley store cover (requires Pillow)."""

from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter, ImageFont
import math


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "release" / "PocketFoley-cover.png"
SIZE = (630, 500)
BG = (9, 10, 14)
ORANGE = (255, 103, 54)


def font(name: str, size: int) -> ImageFont.FreeTypeFont:
    preferred = Path("C:/Windows/Fonts") / name
    return ImageFont.truetype(str(preferred) if preferred.exists() else "DejaVuSans.ttf", size)


def main() -> None:
    image = Image.new("RGB", SIZE, BG)
    glow = Image.new("RGB", SIZE, BG)
    glow_draw = ImageDraw.Draw(glow)
    glow_draw.ellipse((355, -150, 760, 290), fill=(66, 26, 20))
    image = Image.blend(image, glow.filter(ImageFilter.GaussianBlur(90)), 0.8)
    draw = ImageDraw.Draw(image)

    for x in range(40, 630, 40):
        draw.line((x, 0, x, 500), fill=(23, 25, 31), width=1)
    for y in range(40, 500, 40):
        draw.line((0, y, 630, y), fill=(23, 25, 31), width=1)

    draw.rounded_rectangle((46, 37, 104, 95), radius=15, fill=ORANGE)
    draw.line([(57, 67), (65, 67), (70, 54), (76, 79), (82, 59), (87, 68), (95, 68)], fill=BG, width=4, joint="curve")
    draw.text((122, 51), "VV LABS  /  SOUND WORKSHOP", font=font("bahnschrift.ttf", 21), fill=(197, 203, 207))

    draw.text((43, 129), "POCKET", font=font("arialbd.ttf", 82), fill=(247, 244, 238), stroke_width=0)
    draw.text((43, 211), "FOLEY", font=font("arialbd.ttf", 106), fill=ORANGE)
    draw.text((49, 330), "MAKE THE SOUND FIT.", font=font("bahnschrift.ttf", 28), fill=(247, 244, 238))

    baseline = 403
    points = []
    for x in range(44, 589, 2):
        t = (x - 44) / 544
        envelope = math.exp(-((t - 0.5) / 0.36) ** 2)
        pulse = math.sin(t * 42) * math.sin(t * 121)
        y = baseline + int(23 * envelope * pulse)
        points.append((x, y))
    draw.line(points, fill=(56, 231, 173), width=3, joint="curve")
    draw.line((44, 449, 586, 449), fill=(75, 80, 87), width=2)
    draw.text((47, 460), "244 STARTING SOUNDS", font=font("bahnschrift.ttf", 17), fill=(190, 194, 199))
    draw.text((404, 460), "3 TRACKS  /  WAV", font=font("bahnschrift.ttf", 17), fill=(190, 194, 199))

    OUT.parent.mkdir(parents=True, exist_ok=True)
    image.save(OUT, optimize=True)
    print(OUT)


if __name__ == "__main__":
    main()
