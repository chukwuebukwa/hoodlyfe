#!/usr/bin/env python3
"""Build a narrow LPC-to-NOCK0 character spike.

This does not vendor or reimplement the Universal LPC generator. It composes a
single known-good LPC recipe from a local checkout and packs the frames into the
current NOCK0 72px walk/action atlas contract.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Iterable

from PIL import Image


FRAME = 64
NOCK0_FRAME = 72
DOWN_ROW = 2


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_LPC_ROOT = Path("/tmp/ulpc-generator")
OUT_DIR = ROOT / "public/assets/custom/lpc-spike"
LPC_DIRECTIONS = ["up", "left", "down", "right"]


LAYER_ORDER = [
    {
        "id": "body",
        "name": "Body Color light / Human Male",
        "path": "spritesheets/body/bodies/male",
        "variant": None,
        "zPos": 10,
    },
    {
        "id": "sandals",
        "name": "Sandals black",
        "path": "spritesheets/feet/sandals/male",
        "variant": "black",
        "zPos": 15,
    },
    {
        "id": "pants",
        "name": "Formal striped pants navy",
        "path": "spritesheets/legs/formal_striped/male",
        "variant": "navy",
        "zPos": 20,
    },
    {
        "id": "shirt",
        "name": "Sleeveless striped white",
        "path": "spritesheets/torso/clothes/sleeveless/striped/male",
        "variant": "white",
        "zPos": 35,
    },
    {
        "id": "sleeves",
        "name": "Longsleeves 2 Overlay maroon",
        "path": "spritesheets/torso/clothes/longsleeve/longsleeves2/male",
        "variant": None,
        "zPos": 36,
    },
    {
        "id": "head",
        "name": "Human Male light",
        "path": "spritesheets/head/heads/human/male",
        "variant": None,
        "zPos": 100,
    },
    {
        "id": "expression",
        "name": "Neutral light",
        "path": "spritesheets/head/faces/male/neutral",
        "variant": None,
        "zPos": 101,
    },
    {
        "id": "hair",
        "name": "Pixie raven",
        "path": "spritesheets/hair/pixie/adult",
        "variant": None,
        "zPos": 120,
    },
]


RECIPE_HASH = (
    "sex=male&body=Body_Color_light&head=Human_Male_light&expression=Neutral_light"
    "&sleeves=Longsleeves_2_Overlay_maroon&clothes=Sleeveless_striped_white"
)


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
    out_dir.mkdir(parents=True, exist_ok=True)

    walk = Image.new("RGBA", (NOCK0_FRAME * 3, NOCK0_FRAME * 3), (0, 0, 0, 0))
    walk_4dir = Image.new("RGBA", (NOCK0_FRAME * 9, NOCK0_FRAME * 4), (0, 0, 0, 0))
    actions = Image.new("RGBA", (NOCK0_FRAME * 4, NOCK0_FRAME * 3), (0, 0, 0, 0))

    # NOCK0 frame 0 is idle. LPC idle has two columns per direction.
    paste_frame(walk, 0, compose_frame(lpc_root, "idle", 0))
    # NOCK0 walk frames 1-8 map directly to LPC walk-down cycle columns 1-8.
    for target_frame, source_col in enumerate(range(1, 9), start=1):
        paste_frame(walk, target_frame, compose_frame(lpc_root, "walk", source_col))
    for row, _direction in enumerate(LPC_DIRECTIONS):
        paste_grid_frame(walk_4dir, 0, row, compose_frame(lpc_root, "idle", 0, row=row))
        for source_col in range(1, 9):
            paste_grid_frame(
                walk_4dir,
                source_col,
                row,
                compose_frame(lpc_root, "walk", source_col, row=row),
            )

    # NOCK0 action frames 0-3: melee. LPC slash-down gives a believable swing.
    for target_frame, source_col in enumerate(range(4)):
        paste_frame(actions, target_frame, compose_frame(lpc_root, "slash", source_col))
    # Frames 4-7: hit/knockdown/dead. LPC has hurt only, so this is partial.
    for target_frame, source_col in zip(range(4, 8), [0, 1, 3, 5]):
        paste_frame(actions, target_frame, compose_frame(lpc_root, "hurt", source_col, directional=False))
    # Frames 8-11: vehicle enter/carjack. LPC has no equivalent; sit is the least dishonest fallback.
    for target_frame, source_col in zip(range(8, 12), [0, 1, 2, 2]):
        paste_frame(actions, target_frame, compose_frame(lpc_root, "sit", source_col))

    walk.save(out_dir / "player-lpc-walk.png")
    walk_4dir.save(out_dir / "player-lpc-walk-4dir.png")
    actions.save(out_dir / "player-lpc-actions.png")
    pistol_overlay().save(out_dir / "player-lpc-pistol-8dir.png")
    Image.new("RGBA", walk.size, (0, 0, 0, 0)).save(out_dir / "player-lpc-walk-mask.png")
    Image.new("RGBA", walk_4dir.size, (0, 0, 0, 0)).save(out_dir / "player-lpc-walk-4dir-mask.png")
    Image.new("RGBA", actions.size, (0, 0, 0, 0)).save(out_dir / "player-lpc-actions-mask.png")

    (out_dir / "recipe.json").write_text(
        json.dumps(metadata(), indent=2) + "\n",
        encoding="utf-8",
    )

    print(f"Wrote LPC spike assets to {out_dir}")
    return 0


def compose_frame(
    lpc_root: Path,
    animation: str,
    column: int,
    directional: bool = True,
    row: int = DOWN_ROW,
) -> Image.Image:
    frame = Image.new("RGBA", (FRAME, FRAME), (0, 0, 0, 0))
    for layer in LAYER_ORDER:
        source = animation_source(lpc_root, layer["path"], animation, layer["variant"])
        sprite = Image.open(source).convert("RGBA")
        y = row * FRAME if directional else 0
        piece = sprite.crop((column * FRAME, y, (column + 1) * FRAME, y + FRAME))
        frame.alpha_composite(piece)
    return frame


def animation_source(lpc_root: Path, base: str, animation: str, variant: str | None) -> Path:
    root = lpc_root / base
    animation_names = [animation]
    if animation not in {"walk"}:
        animation_names.append("walk")
    candidates: Iterable[Path]
    if variant:
        candidates = [
            candidate
            for name in animation_names
            for candidate in (
                root / name / f"{variant}.png",
                root / f"{name}.png",
            )
        ] + [root / f"{variant}.png"]
    else:
        candidates = [
            candidate
            for name in animation_names
            for candidate in (
                root / f"{name}.png",
                root / name / "base.png",
            )
        ]
    for candidate in candidates:
        if candidate.exists():
            return candidate
    raise FileNotFoundError(f"Missing LPC sprite for {base} {animation} {variant or ''}".strip())


def paste_frame(atlas: Image.Image, index: int, frame: Image.Image) -> None:
    col_count = atlas.width // NOCK0_FRAME
    paste_grid_frame(atlas, index % col_count, index // col_count, frame)


def paste_grid_frame(atlas: Image.Image, column: int, row: int, frame: Image.Image) -> None:
    x = column * NOCK0_FRAME
    y = row * NOCK0_FRAME
    # Center 64px LPC frames in NOCK0's 72px contract. This keeps root/center close
    # without scaling the pixel art.
    atlas.alpha_composite(frame, (x + 4, y + 4))


def pistol_overlay() -> Image.Image:
    atlas = Image.new("RGBA", (NOCK0_FRAME * 8, NOCK0_FRAME), (0, 0, 0, 0))
    # Sector order follows server aim radians: east, southeast, south, southwest,
    # west, northwest, north, northeast.
    directions = [
        (1, 0),
        (1, 1),
        (0, 1),
        (-1, 1),
        (-1, 0),
        (-1, -1),
        (0, -1),
        (1, -1),
    ]
    for index, direction in enumerate(directions):
        frame = Image.new("RGBA", (NOCK0_FRAME, NOCK0_FRAME), (0, 0, 0, 0))
        draw_pistol_pose(frame, direction)
        atlas.alpha_composite(frame, (index * NOCK0_FRAME, 0))
    return atlas


def draw_pistol_pose(frame: Image.Image, direction: tuple[int, int]) -> None:
    from PIL import ImageDraw

    draw = ImageDraw.Draw(frame)
    dx, dy = direction
    length = max(1, (dx * dx + dy * dy) ** 0.5)
    ux = dx / length
    uy = dy / length
    # The hand anchor is intentionally near the torso center of the LPC adult.
    hand = (36 + round(ux * 5), 35 + round(uy * 3))
    muzzle = (hand[0] + round(ux * 22), hand[1] + round(uy * 22))
    grip = (hand[0] - round(uy * 4), hand[1] + round(ux * 4))
    off = (-uy, ux)
    skin = (216, 160, 124, 255)
    sleeve = (245, 242, 224, 255)
    outline = (22, 18, 18, 255)
    metal = (165, 174, 178, 255)
    dark = (20, 24, 27, 255)
    accent = (229, 197, 90, 255)

    arm_start = (36 - round(ux * 5), 36 - round(uy * 4))
    arm_end = (hand[0] - round(ux * 2), hand[1] - round(uy * 2))
    draw.line([arm_start, arm_end], fill=outline, width=7)
    draw.line([arm_start, arm_end], fill=sleeve, width=5)
    draw.ellipse((hand[0] - 4, hand[1] - 4, hand[0] + 4, hand[1] + 4), fill=outline)
    draw.ellipse((hand[0] - 3, hand[1] - 3, hand[0] + 3, hand[1] + 3), fill=skin)

    barrel_a = (hand[0] + round(off[0] * 3), hand[1] + round(off[1] * 3))
    barrel_b = (muzzle[0] + round(off[0] * 3), muzzle[1] + round(off[1] * 3))
    barrel_c = (muzzle[0] - round(off[0] * 3), muzzle[1] - round(off[1] * 3))
    barrel_d = (hand[0] - round(off[0] * 3), hand[1] - round(off[1] * 3))
    draw.polygon([barrel_a, barrel_b, barrel_c, barrel_d], fill=outline)
    inner_a = (hand[0] + round(off[0] * 1), hand[1] + round(off[1] * 1))
    inner_b = (muzzle[0] + round(off[0] * 1), muzzle[1] + round(off[1] * 1))
    inner_c = (muzzle[0] - round(off[0] * 1), muzzle[1] - round(off[1] * 1))
    inner_d = (hand[0] - round(off[0] * 1), hand[1] - round(off[1] * 1))
    draw.polygon([inner_a, inner_b, inner_c, inner_d], fill=metal)
    draw.line([hand, muzzle], fill=dark, width=2)
    draw.line([hand, grip], fill=outline, width=6)
    draw.line([hand, grip], fill=dark, width=4)
    draw.ellipse((muzzle[0] - 2, muzzle[1] - 2, muzzle[0] + 2, muzzle[1] + 2), fill=accent)


def metadata() -> dict:
    return {
        "source": "Universal LPC Spritesheet Character Generator",
        "sourceUrl": "https://github.com/liberatedpixelcup/Universal-LPC-Spritesheet-Character-Generator",
        "generatorRecipeUrl": (
            "https://liberatedpixelcup.github.io/Universal-LPC-Spritesheet-Character-Generator/#"
            + RECIPE_HASH
        ),
        "recipeHash": RECIPE_HASH,
        "bodyType": "male",
        "nock0Contract": {
            "walk": "216x216, 3x3, 72px frames",
            "walk4dir": "648x288, 9x4, 72px frames; rows are up,left,down,right",
            "actions": "288x216, 4x3, 72px frames",
        },
        "mapping": {
            "idle": "LPC idle/down column 0 -> NOCK0 walk frame 0",
            "walk": "LPC walk/down columns 1-8 -> NOCK0 walk frames 1-8",
            "melee": "LPC slash/down columns 0-3 -> NOCK0 action frames 0-3",
            "hitKnockdownDead": "LPC hurt columns 0,1,3,5 -> NOCK0 action frames 4-7",
            "vehicleEnterCarjack": "LPC sit/down columns 0,1,2,2 -> NOCK0 action frames 8-11",
            "pistolOverlay": "NOCK0-authored 8-sector pistol/hand overlay, not from LPC",
        },
        "gaps": [
            "LPC does not provide NOCK0-style top-down vehicle entry/carjacking frames.",
            "LPC hurt is not a full knockdown/death sequence.",
            "LPC frame size and camera angle are 64px RPG side/front/back, not NOCK0's current 72px near-overhead action art.",
            "This recipe includes OGA-BY, CC-BY-SA, GPL-family asset credits; production use needs an attribution/license pass.",
        ],
        "layers": LAYER_ORDER,
    }


if __name__ == "__main__":
    raise SystemExit(main())
