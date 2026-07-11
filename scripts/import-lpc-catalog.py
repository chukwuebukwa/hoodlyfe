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

BASE_LAYERS = [
    "spritesheets/body/bodies/male",
    "spritesheets/head/heads/human/male",
    "spritesheets/head/faces/male/neutral",
    "spritesheets/head/faces/male/happy",
    "spritesheets/head/faces/male/anger",
    "spritesheets/hair/pixie/adult",
    "spritesheets/hair/buzzcut/adult",
    "spritesheets/hair/messy1/adult",
    "spritesheets/hair/afro/adult",
    "spritesheets/hair/long/adult",
    "spritesheets/hair/ponytail/adult/bg",
    "spritesheets/hair/ponytail/adult/fg",
    "spritesheets/hat/cloth/leather_cap/adult",
    "spritesheets/hat/formal/tophat/adult",
    "spritesheets/hat/helmet/norman/adult",
    "spritesheets/hat/helmet/flattop/male",
]

COLOR_LAYERS = [
    "spritesheets/torso/clothes/vest/male",
    "spritesheets/torso/clothes/longsleeve/laced/male",
    "spritesheets/torso/clothes/sleeveless/sleeveless/male",
    "spritesheets/torso/clothes/vest_open/male",
    "spritesheets/legs/pants/male",
    "spritesheets/legs/formal_striped/male",
    "spritesheets/legs/shorts/shorts/male",
    "spritesheets/feet/shoes/basic/male",
    "spritesheets/feet/boots/basic/male",
    "spritesheets/feet/sandals/male",
    "spritesheets/hat/holiday/christmas/adult",
    "spritesheets/hat/pirate/cavalier/adult",
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
                copied.extend(copy_candidates(lpc_root, out_dir, layer, animation, color))
    copied.extend(create_smiley_tee(lpc_root, out_dir))
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


def create_smiley_tee(lpc_root: Path, out_dir: Path) -> list[str]:
    layer = "spritesheets/torso/clothes/custom/smiley_tee/male"
    source_layer = Path("spritesheets/torso/clothes/shortsleeve/tshirt/male")
    copied = []
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
    layer = "spritesheets/feet/boots/custom/timbs/male"
    source_layer = Path("spritesheets/feet/boots/basic/male")
    copied = []
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
