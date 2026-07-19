#!/usr/bin/env python3
"""Copy a curated Universal LPC catalog into public assets for the browser editor."""

from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_LPC_ROOT = Path("/tmp/ulpc-generator")
OUT_DIR = ROOT / "public/assets/custom/lpc-catalog"
PUBLIC_ROOT = "/assets/custom/lpc-catalog"
ANIMATIONS = ["idle", "walk", "slash", "hurt", "sit"]
COLORS = ["black", "charcoal", "white", "maroon", "orange", "red", "navy", "blue", "green", "brown", "leather"]
COLOR_RGB = {
    "black": (27, 30, 32),
    "charcoal": (48, 55, 58),
    "white": (232, 233, 223),
    "maroon": (114, 45, 59),
    "orange": (201, 95, 22),
    "red": (185, 64, 62),
    "navy": (38, 63, 102),
    "blue": (66, 105, 184),
    "green": (60, 122, 76),
    "brown": (122, 81, 54),
    "leather": (154, 99, 57),
}

BASE_LAYERS = [
    "spritesheets/body/bodies/male",
    "spritesheets/body/bodies/female",
    "spritesheets/head/heads/human/male",
    "spritesheets/head/heads/human/female",
    "spritesheets/head/faces/male/neutral",
    "spritesheets/head/faces/male/happy",
    "spritesheets/head/faces/male/anger",
    "spritesheets/head/faces/male/blush",
    "spritesheets/head/faces/male/closed",
    "spritesheets/head/faces/male/look_l",
    "spritesheets/head/faces/male/look_r",
    "spritesheets/head/faces/male/sad",
    "spritesheets/head/faces/male/shame",
    "spritesheets/head/faces/male/shock",
    "spritesheets/head/faces/female/neutral",
    "spritesheets/head/faces/female/happy",
    "spritesheets/head/faces/female/anger",
    "spritesheets/head/faces/female/blush",
    "spritesheets/head/faces/female/closed",
    "spritesheets/head/faces/female/look_l",
    "spritesheets/head/faces/female/look_r",
    "spritesheets/head/faces/female/sad",
    "spritesheets/head/faces/female/shame",
    "spritesheets/head/faces/female/shock",
    "spritesheets/hair/pixie/adult",
    "spritesheets/hair/buzzcut/adult",
    "spritesheets/hair/messy1/adult",
    "spritesheets/hair/afro/adult",
    "spritesheets/hair/cornrows/adult",
    "spritesheets/hair/curly_short/adult",
    "spritesheets/hair/dreadlocks_short/adult",
    "spritesheets/hair/twists_fade/adult",
    "spritesheets/hair/long/adult",
    "spritesheets/hair/braid/adult/bg",
    "spritesheets/hair/braid/adult/fg",
    "spritesheets/hair/braid2/adult/bg",
    "spritesheets/hair/braid2/adult/fg",
    "spritesheets/hair/ponytail/adult/bg",
    "spritesheets/hair/ponytail/adult/fg",
    "spritesheets/hat/cloth/leather_cap/adult",
    "spritesheets/hat/cloth/hood/adult",
    "spritesheets/hat/formal/tophat/adult",
    "spritesheets/hat/helmet/norman/adult",
    "spritesheets/hat/helmet/flattop/male",
]

COLOR_LAYERS = [
    "spritesheets/torso/clothes/vest/male",
    "spritesheets/torso/clothes/longsleeve/laced/male",
    "spritesheets/torso/clothes/sleeveless/sleeveless/male",
    "spritesheets/torso/clothes/vest_open/male",
    "spritesheets/torso/clothes/shortsleeve/shortsleeve_polo/male",
    "spritesheets/torso/clothes/shortsleeve/shortsleeve_polo/female",
    "spritesheets/torso/clothes/shortsleeve/tshirt_buttoned/male",
    "spritesheets/torso/clothes/shortsleeve/tshirt_buttoned/female",
    "spritesheets/torso/clothes/longsleeve/longsleeve2_cardigan/male",
    "spritesheets/torso/clothes/longsleeve/longsleeve2_cardigan/female",
    "spritesheets/torso/aprons/overalls/male",
    "spritesheets/torso/aprons/overalls/female",
    "spritesheets/torso/aprons/suspenders/male",
    "spritesheets/torso/aprons/suspenders/female",
    "spritesheets/torso/armour/leather/male",
    "spritesheets/torso/armour/leather/female",
    "spritesheets/torso/chainmail/male",
    "spritesheets/torso/chainmail/female",
    "spritesheets/torso/clothes/shortsleeve/tshirt/female",
    "spritesheets/torso/clothes/longsleeve/longsleeve/female",
    "spritesheets/torso/clothes/sleeveless/sleeveless/female",
    "spritesheets/torso/clothes/blouse/female",
    "spritesheets/legs/pants/male",
    "spritesheets/legs/pants/female",
    "spritesheets/legs/formal/male",
    "spritesheets/legs/formal/thin",
    "spritesheets/legs/formal_striped/male",
    "spritesheets/legs/formal_striped/thin",
    "spritesheets/legs/cuffed/male",
    "spritesheets/legs/cuffed/thin",
    "spritesheets/legs/leggings/male",
    "spritesheets/legs/leggings/thin",
    "spritesheets/legs/shorts/shorts/male",
    "spritesheets/legs/shorts/shorts/thin",
    "spritesheets/legs/skirts/plain/male",
    "spritesheets/legs/skirts/plain/thin",
    "spritesheets/legs/armour/plate/male",
    "spritesheets/legs/armour/plate/thin",
    "spritesheets/feet/shoes/basic/male",
    "spritesheets/feet/shoes/basic/thin",
    "spritesheets/feet/shoes/revised/male",
    "spritesheets/feet/shoes/revised/thin",
    "spritesheets/feet/boots/basic/male",
    "spritesheets/feet/boots/basic/thin",
    "spritesheets/feet/boots/fold/male",
    "spritesheets/feet/boots/fold/thin",
    "spritesheets/feet/sandals/male",
    "spritesheets/feet/sandals/thin",
    "spritesheets/feet/slippers/male",
    "spritesheets/feet/slippers/thin",
    "spritesheets/hat/cloth/bandana/adult",
    "spritesheets/hat/formal/bowler/adult",
    "spritesheets/hat/formal/crown/adult",
    "spritesheets/hat/formal/tiara/adult",
    "spritesheets/hat/holiday/christmas/adult",
    "spritesheets/hat/holiday/santa/adult",
    "spritesheets/hat/holiday/elf/adult",
    "spritesheets/hat/magic/wizard/base/adult",
    "spritesheets/hat/pirate/bandana/adult",
    "spritesheets/hat/pirate/cavalier/adult",
    "spritesheets/hat/pirate/tricorne/basic/adult",
]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--lpc-root", type=Path, default=DEFAULT_LPC_ROOT)
    parser.add_argument("--out-dir", type=Path, default=OUT_DIR)
    args = parser.parse_args()

    lpc_root = args.lpc_root.resolve()
    if not (lpc_root / "spritesheets/body/bodies/male/walk.png").exists():
        raise SystemExit(
            f"Universal LPC checkout not found at {lpc_root}. "
            "Clone https://github.com/liberatedpixelcup/Universal-LPC-Spritesheet-Character-Generator first."
        )

    out_dir = args.out_dir.resolve()
    if out_dir.exists():
        shutil.rmtree(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    copied: list[str] = []
    for layer in BASE_LAYERS:
        for animation in ANIMATIONS:
            copied.extend(copy_candidates(lpc_root, out_dir, layer, animation, None))
    for layer in COLOR_LAYERS:
        for animation in ANIMATIONS:
            copied.extend(copy_candidates(lpc_root, out_dir, layer, animation, None))
            for color in COLORS:
                color_copies = copy_candidates(lpc_root, out_dir, layer, animation, color)
                if color_copies:
                    copied.extend(color_copies)
                else:
                    generated = create_color_variant(lpc_root, out_dir, layer, animation, color)
                    if generated:
                        copied.append(generated)
    copied.extend(create_smiley_tee(lpc_root, out_dir))
    copied.extend(create_puffer_jacket(lpc_root, out_dir))
    copied.extend(create_timbs(lpc_root, out_dir))
    copied.extend(create_yarmulke(lpc_root, out_dir))

    assets = sorted(set(copied))
    (out_dir / "manifest.json").write_text(
        json.dumps({
            "source": "Universal LPC Spritesheet Character Generator",
            "sourceUrl": "https://github.com/liberatedpixelcup/Universal-LPC-Spritesheet-Character-Generator",
            "assetCount": len(assets),
            "assets": assets,
        }, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"Wrote {len(assets)} LPC catalog assets to {out_dir}")
    return 0


def copy_candidates(
    lpc_root: Path,
    out_dir: Path,
    layer: str,
    animation: str,
    color: str | None,
) -> list[str]:
    candidates = []
    if color:
        candidates.append(Path(layer) / animation / f"{color}.png")
    else:
        candidates.append(Path(layer) / f"{animation}.png")
    copied = []
    for relative in candidates:
        source = lpc_root / relative
        if not source.exists():
            continue
        target = out_dir / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)
        copied.append(f"{PUBLIC_ROOT}/{relative.as_posix()}")
    return copied


def create_color_variant(
    lpc_root: Path,
    out_dir: Path,
    layer: str,
    animation: str,
    color: str,
) -> str | None:
    source = lpc_root / layer / f"{animation}.png"
    if not source.exists():
        return None
    sheet = Image.open(source).convert("RGBA")
    tint_sheet(sheet, COLOR_RGB[color])
    relative = Path(layer) / animation / f"{color}.png"
    target = out_dir / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(target)
    return f"{PUBLIC_ROOT}/{relative.as_posix()}"


def tint_sheet(sheet: Image.Image, target_rgb: tuple[int, int, int]) -> None:
    pixels = sheet.load()
    width, height = sheet.size
    for y in range(height):
        for x in range(width):
            red, green, blue, alpha = pixels[x, y]
            if alpha == 0:
                continue
            luminance = (red * 0.299 + green * 0.587 + blue * 0.114) / 255
            shade = 0.44 + luminance * 0.9
            pixels[x, y] = (
                min(255, round(target_rgb[0] * shade)),
                min(255, round(target_rgb[1] * shade)),
                min(255, round(target_rgb[2] * shade)),
                alpha,
            )


def create_smiley_tee(lpc_root: Path, out_dir: Path) -> list[str]:
    copied = []
    for shape, source_layer in [
        ("male", Path("spritesheets/torso/clothes/shortsleeve/tshirt/male")),
        ("thin", Path("spritesheets/torso/clothes/shortsleeve/tshirt/female")),
    ]:
        layer = f"spritesheets/torso/clothes/custom/smiley_tee/{shape}"
        for animation in ANIMATIONS:
            source = lpc_root / source_layer / f"{animation}.png"
            if not source.exists():
                source = lpc_root / source_layer / "walk.png"
            sheet = Image.open(source).convert("RGBA")
            draw_smiley_marks(sheet)
            relative = Path(layer) / f"{animation}.png"
            target = out_dir / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            sheet.save(target)
            copied.append(f"{PUBLIC_ROOT}/{relative.as_posix()}")
    return copied


def create_timbs(lpc_root: Path, out_dir: Path) -> list[str]:
    copied = []
    for shape in ["male", "thin"]:
        layer = f"spritesheets/feet/boots/custom/timbs/{shape}"
        source_layer = Path(f"spritesheets/feet/boots/basic/{shape}")
        for animation in ANIMATIONS:
            source = lpc_root / source_layer / f"{animation}.png"
            if not source.exists():
                source = lpc_root / source_layer / "walk.png"
            sheet = Image.open(source).convert("RGBA")
            paint_timbs(sheet)
            relative = Path(layer) / f"{animation}.png"
            target = out_dir / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            sheet.save(target)
            copied.append(f"{PUBLIC_ROOT}/{relative.as_posix()}")
    return copied


def create_puffer_jacket(lpc_root: Path, out_dir: Path) -> list[str]:
    copied = []
    for shape, source_layer in [
        ("male", Path("spritesheets/torso/clothes/longsleeve/longsleeve/male")),
        ("thin", Path("spritesheets/torso/clothes/longsleeve/longsleeve/female")),
    ]:
        layer = f"spritesheets/torso/clothes/custom/puffer/{shape}"
        for animation in ANIMATIONS:
            source = lpc_root / source_layer / f"{animation}.png"
            if not source.exists():
                source = lpc_root / source_layer / "walk.png"
            base_sheet = Image.open(source).convert("RGBA")
            relative = Path(layer) / f"{animation}.png"
            target = out_dir / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            fallback = Image.new("RGBA", base_sheet.size, (0, 0, 0, 0))
            paint_puffer(fallback, base_sheet, COLOR_RGB["black"])
            fallback.save(target)
            copied.append(f"{PUBLIC_ROOT}/{relative.as_posix()}")
            for color in COLORS:
                sheet = Image.new("RGBA", base_sheet.size, (0, 0, 0, 0))
                paint_puffer(sheet, base_sheet, COLOR_RGB[color])
                relative = Path(layer) / animation / f"{color}.png"
                target = out_dir / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                sheet.save(target)
                copied.append(f"{PUBLIC_ROOT}/{relative.as_posix()}")
    return copied


def create_yarmulke(lpc_root: Path, out_dir: Path) -> list[str]:
    layer = "spritesheets/hat/custom/yarmulke/adult"
    copied = []
    for animation in ANIMATIONS:
        source = lpc_root / "spritesheets/head/heads/human/male" / f"{animation}.png"
        if not source.exists():
            source = lpc_root / "spritesheets/head/heads/human/male/walk.png"
        base = Image.open(source).convert("RGBA")
        sheet = Image.new("RGBA", base.size, (0, 0, 0, 0))
        paint_yarmulke(sheet, base)
        relative = Path(layer) / f"{animation}.png"
        target = out_dir / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        sheet.save(target)
        copied.append(f"{PUBLIC_ROOT}/{relative.as_posix()}")
    return copied


def paint_yarmulke(sheet: Image.Image, head_sheet: Image.Image) -> None:
    pixels = sheet.load()
    head_pixels = head_sheet.load()
    frame = 64
    rows = max(1, sheet.height // frame)
    columns = max(1, sheet.width // frame)
    navy = (22, 35, 76, 255)
    shadow = (10, 17, 40, 255)
    highlight = (66, 88, 150, 255)
    patterns = {
        0: ["..HHHHH..", ".NNNNNNN.", "SNNNNNNS", ".SSSSS.."],
        1: [".HHHH.", "NNNNNN", "SNNNNS", ".SSS.."],
        2: ["..HHHHH..", ".NNNNNNN.", "SNNNNNNS", ".SSSSS.."],
        3: [".HHHH.", "NNNNNN", "SNNNNS", "..SSS."],
    }
    for row in range(rows):
        pattern = patterns.get(row, patterns[2])
        for column in range(columns):
            bounds = frame_alpha_bounds(head_pixels, column, row, frame)
            if bounds is None:
                continue
            min_x, max_x, min_y, _max_y = bounds
            cx = column * frame + (min_x + max_x) // 2
            if row == 1:
                cx += 2
            elif row == 3:
                cx -= 2
            cy = row * frame + min_y + 2
            height = len(pattern)
            width = max(len(line) for line in pattern)
            for py, line in enumerate(pattern):
                for px, mark in enumerate(line):
                    if mark == ".":
                        continue
                    color = highlight if mark == "H" else shadow if mark == "S" else navy
                    pixels[cx - width // 2 + px, cy - height // 2 + py] = color


def frame_alpha_bounds(pixels, column: int, row: int, frame: int):
    x0 = column * frame
    y0 = row * frame
    points = [
        (x - x0, y - y0)
        for y in range(y0, y0 + frame)
        for x in range(x0, x0 + frame)
        if pixels[x, y][3] > 0
    ]
    if not points:
        return None
    xs = [x for x, _ in points]
    ys = [y for _, y in points]
    return min(xs), max(xs), min(ys), max(ys)


def paint_timbs(sheet: Image.Image) -> None:
    pixels = sheet.load()
    frame = 64
    rows = max(1, sheet.height // frame)
    columns = max(1, sheet.width // frame)
    wheat = (190, 124, 44)
    wheat_light = (220, 156, 67)
    wheat_dark = (125, 78, 35)
    sole = (102, 63, 34, 255)
    sole_light = (153, 94, 45, 255)
    collar = (48, 38, 34, 255)
    lace = (232, 184, 96, 255)
    eyelet = (79, 55, 35, 255)
    for row in range(rows):
        for column in range(columns):
            x0 = column * frame
            y0 = row * frame
            points = [
                (x, y)
                for y in range(y0, y0 + frame)
                for x in range(x0, x0 + frame)
                if pixels[x, y][3] > 0
            ]
            if not points:
                continue
            min_x = min(x for x, _ in points)
            max_x = max(x for x, _ in points)
            min_y = min(y for _, y in points)
            max_y = max(y for _, y in points)
            for x, y in points:
                r, g, b, a = pixels[x, y]
                luminance = (r * 0.299 + g * 0.587 + b * 0.114) / 255
                if y >= max_y - 1:
                    pixels[x, y] = sole_light if luminance > 0.62 else sole
                elif y <= min_y + 1:
                    pixels[x, y] = collar
                else:
                    source = wheat_light if luminance > 0.74 else wheat if luminance > 0.38 else wheat_dark
                    pixels[x, y] = (*source, a)
            width = max_x - min_x + 1
            height = max_y - min_y + 1
            if width < 4 or height < 4:
                continue
            cx = (min_x + max_x) // 2
            for dx in (-2, 2):
                x = cx + dx
                y = min_y + 2
                if min_x <= x <= max_x and pixels[x, y][3] > 0:
                    pixels[x, y] = eyelet
            for offset in range(3):
                x = cx - 1 + offset
                y = min_y + 3 + offset // 2
                if min_x <= x <= max_x and min_y <= y <= max_y and pixels[x, y][3] > 0:
                    pixels[x, y] = lace
            for x in range(min_x, max_x + 1, 2):
                y = max_y
                if pixels[x, y][3] > 0:
                    pixels[x, y] = sole


def paint_puffer(sheet: Image.Image, source_sheet: Image.Image, base_color: tuple[int, int, int]) -> None:
    pixels = sheet.load()
    source_pixels = source_sheet.load()
    frame = 64
    rows = max(1, sheet.height // frame)
    columns = max(1, sheet.width // frame)
    trim = (8, 10, 12, 255)
    trim_soft = (16, 18, 20, 235)
    zipper = (225, 220, 198, 255)
    shadow = (0, 0, 0, 120)
    sweater = (225, 214, 185, 255)
    for row in range(rows):
        for column in range(columns):
            x0 = column * frame
            y0 = row * frame
            points = [
                (x, y)
                for y in range(y0, y0 + frame)
                for x in range(x0, x0 + frame)
                if source_pixels[x, y][3] > 0
            ]
            if not points:
                continue
            min_x = min(x for x, _ in points)
            max_x = max(x for x, _ in points)
            min_y = min(y for _, y in points)
            max_y = max(y for _, y in points)
            if max_y - min_y < 8 or max_x - min_x < 8:
                continue
            cx = (min_x + max_x) // 2
            jacket_points = dilated_points(points, x0, y0, frame, 1)
            for x, y in jacket_points:
                source_alpha = max_source_alpha(source_pixels, x, y, x0, y0, frame)
                edge = x <= min_x - 1 or x >= max_x + 1 or y <= min_y or y >= max_y
                y_local = y - min_y
                band = y_local % 7
                horizontal_gloss = 1.0 + max(0, 1.0 - abs((x - (min_x + 4)) / 8)) * 0.42
                shade = 0.72 if edge else 0.92
                if band in (0, 1):
                    shade *= 0.50
                elif band in (3, 4):
                    shade *= 1.28
                shade *= horizontal_gloss
                pixels[x, y] = (
                    min(255, round(base_color[0] * shade)),
                    min(255, round(base_color[1] * shade)),
                    min(255, round(base_color[2] * shade)),
                    max(210, source_alpha),
                )
            panel_top = min_y + 4
            panel_bottom = max_y - 3
            if row == 2:
                for y in range(panel_top + 2, panel_bottom + 1):
                    for x in range(cx - 3, cx + 4):
                        if (x, y) in jacket_points:
                            pixels[x, y] = sweater
            for y in range(min_y + 5, max_y - 1, 7):
                for x in range(min_x + 1, max_x):
                    if (x, y) in jacket_points:
                        pixels[x, y] = shadow
                    if (x, y + 2) in jacket_points:
                        pixels[x, y + 2] = highlight_for(base_color)
            for y in range(min_y + 2, max_y - 1):
                for x in (cx - 4, cx + 4):
                    if (x, y) in jacket_points:
                        pixels[x, y] = trim
                if (cx, y) in jacket_points:
                    pixels[cx, y] = zipper if (y - min_y) % 4 in (0, 1) else trim
            for x, y in list(jacket_points):
                if y >= max_y - 1:
                    pixels[x, y] = trim_soft
                elif y <= min_y + 2 and abs(x - cx) <= 9:
                    pixels[x, y] = trim
                elif y <= min_y + 7 and (x <= min_x + 1 or x >= max_x - 1):
                    pixels[x, y] = trim


def dilated_points(
    points: list[tuple[int, int]],
    x0: int,
    y0: int,
    frame: int,
    radius: int,
) -> set[tuple[int, int]]:
    source = set(points)
    output: set[tuple[int, int]] = set()
    for x, y in source:
        for dy in range(-radius, radius + 1):
            for dx in range(-radius, radius + 1):
                if abs(dx) + abs(dy) > radius + 1:
                    continue
                nx = x + dx
                ny = y + dy
                if x0 <= nx < x0 + frame and y0 <= ny < y0 + frame:
                    output.add((nx, ny))
    return output


def max_source_alpha(pixels, x: int, y: int, x0: int, y0: int, frame: int) -> int:
    alpha = 0
    for dy in range(-1, 2):
        for dx in range(-1, 2):
            nx = x + dx
            ny = y + dy
            if x0 <= nx < x0 + frame and y0 <= ny < y0 + frame:
                alpha = max(alpha, pixels[nx, ny][3])
    return alpha


def highlight_for(color: tuple[int, int, int]) -> tuple[int, int, int, int]:
    return (
        min(255, round(color[0] * 1.55 + 22)),
        min(255, round(color[1] * 1.55 + 22)),
        min(255, round(color[2] * 1.55 + 22)),
        165,
    )


def draw_smiley_marks(sheet: Image.Image) -> None:
    pixels = sheet.load()
    frame = 64
    rows = max(1, sheet.height // frame)
    columns = max(1, sheet.width // frame)
    # The chest graphic is only readable on front-facing frames. Side/back rows
    # keep the base shirt clean.
    down_row = 2 if rows >= 4 else 0
    yellow = (247, 207, 58, 255)
    ink = (39, 34, 28, 255)
    decal = {
        (-1, -3): yellow, (0, -3): yellow, (1, -3): yellow,
        (-2, -2): yellow, (-1, -2): ink, (0, -2): yellow, (1, -2): ink, (2, -2): yellow,
        (-3, -1): yellow, (-2, -1): yellow, (-1, -1): yellow, (0, -1): yellow, (1, -1): yellow, (2, -1): yellow, (3, -1): yellow,
        (-3, 0): yellow, (-2, 0): yellow, (-1, 0): yellow, (0, 0): yellow, (1, 0): yellow, (2, 0): yellow, (3, 0): yellow,
        (-2, 1): yellow, (-1, 1): ink, (0, 1): yellow, (1, 1): ink, (2, 1): yellow,
        (-1, 2): yellow, (0, 2): ink, (1, 2): yellow,
    }
    for column in range(columns):
        cx = column * frame + 32
        cy = down_row * frame + 42
        for (dx, dy), color in decal.items():
            x = cx + dx
            y = cy + dy
            if pixels[x, y][3] == 0:
                continue
            pixels[x, y] = color


if __name__ == "__main__":
    raise SystemExit(main())
