#!/usr/bin/env python3
"""Generate the Android launcher icon from the EverLine mark.

The mark is src/assets/logo.png, a solid glyph on a transparent background (the same file the web
app draws through a CSS mask). It is tinted amber, as the web BrandMark is, and placed on the app's
dark background (#0A0D10), per mobile-design-system.md section 5.

Writes, for every density:
  mipmap-<d>/ic_launcher_foreground.png   adaptive icon foreground layer (108 dp canvas, mark inside the 66 dp safe zone)
  mipmap-<d>/ic_launcher.png              legacy square icon (Android 7.x)
  mipmap-<d>/ic_launcher_round.png        legacy round icon
The adaptive background is the colour in res/values/ic_launcher_background.xml.

Needs Pillow:  python3 scripts/generate-icons.py
"""
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
LOGO = ROOT / "src" / "assets" / "logo.png"
RES = ROOT / "android" / "app" / "src" / "main" / "res"

BACKGROUND = (0x0A, 0x0D, 0x10, 255)
MARK = (0xF5, 0xA6, 0x23)
DENSITIES = {"mdpi": 1.0, "hdpi": 1.5, "xhdpi": 2.0, "xxhdpi": 3.0, "xxxhdpi": 4.0}


def tinted_mark(box_px: int) -> Image.Image:
    """The glyph cropped to its outline, scaled to fit a square of box_px, filled with the mark colour."""
    logo = Image.open(LOGO).convert("RGBA")
    alpha = logo.getchannel("A")
    box = alpha.getbbox()
    if box is None:
        raise SystemExit(f"{LOGO} has no visible pixels")
    alpha = alpha.crop(box)
    scale = box_px / max(alpha.size)
    size = (max(1, round(alpha.width * scale)), max(1, round(alpha.height * scale)))
    alpha = alpha.resize(size, Image.LANCZOS)
    mark = Image.new("RGBA", size, MARK + (0,))
    mark.putalpha(alpha)
    return mark


def centred(canvas: Image.Image, mark: Image.Image) -> Image.Image:
    canvas.alpha_composite(mark, ((canvas.width - mark.width) // 2, (canvas.height - mark.height) // 2))
    return canvas


def main() -> None:
    for name, density in DENSITIES.items():
        out = RES / f"mipmap-{name}"
        out.mkdir(parents=True, exist_ok=True)

        # Adaptive foreground: 108 dp canvas, transparent, the mark about 52 dp across (safe zone is 66 dp).
        side = round(108 * density)
        foreground = centred(Image.new("RGBA", (side, side), (0, 0, 0, 0)), tinted_mark(round(52 * density)))
        foreground.save(out / "ic_launcher_foreground.png")

        # Legacy square (rounded corners) and round icons: 48 dp.
        side = round(48 * density)
        square = Image.new("RGBA", (side, side), (0, 0, 0, 0))
        ImageDraw.Draw(square).rounded_rectangle((0, 0, side - 1, side - 1), radius=round(8 * density), fill=BACKGROUND)
        centred(square, tinted_mark(round(30 * density))).save(out / "ic_launcher.png")

        round_icon = Image.new("RGBA", (side, side), (0, 0, 0, 0))
        ImageDraw.Draw(round_icon).ellipse((0, 0, side - 1, side - 1), fill=BACKGROUND)
        centred(round_icon, tinted_mark(round(28 * density))).save(out / "ic_launcher_round.png")
        print(f"mipmap-{name}: foreground {round(108 * density)} px, legacy {side} px")


if __name__ == "__main__":
    main()
