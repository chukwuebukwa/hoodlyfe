#!/usr/bin/env python3
"""Install a 96px top-down vehicle sprite as a NOCK0 vehicle door atlas row.

This is useful for quick experiments. For production source-of-truth changes,
prefer scripts/build-vehicle-door-atlas.py with per-vehicle source folders.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Iterable

from PIL import Image


CELL_SIZE = 96
DOOR_COLUMNS = 5


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Append or replace one 5-frame row in public/assets/custom/actions/"
            "vehicle-doors.png. If open-door frames are omitted, the closed "
            "vehicle sprite is duplicated so a generated car is playable now."
        )
    )
    parser.add_argument("--closed", required=True, help="Closed top-down vehicle PNG, 96x96 RGBA.")
    parser.add_argument("--front-left", help="Optional 96x96 front-left-open door frame.")
    parser.add_argument("--front-right", help="Optional 96x96 front-right-open door frame.")
    parser.add_argument("--rear-left", help="Optional 96x96 rear-left-open door frame.")
    parser.add_argument("--rear-right", help="Optional 96x96 rear-right-open door frame.")
    parser.add_argument(
        "--atlas",
        default="public/assets/custom/actions/vehicle-doors.png",
        help="Existing NOCK0 vehicle door atlas."
    )
    parser.add_argument(
        "--output",
        default="public/assets/custom/actions/vehicle-doors.png",
        help="Atlas output path. Defaults to replacing --atlas."
    )
    parser.add_argument(
        "--row-index",
        type=int,
        help="Replace this zero-based row. Omit to append a new vehicle row."
    )
    return parser.parse_args()


def load_frame(path: str | None, fallback: Image.Image) -> Image.Image:
    if not path:
        return fallback.copy()
    image = Image.open(path).convert("RGBA")
    if image.size != (CELL_SIZE, CELL_SIZE):
        raise SystemExit(f"{path} must be {CELL_SIZE}x{CELL_SIZE}; got {image.size}.")
    return image


def paste_row(atlas: Image.Image, row_index: int, frames: Iterable[Image.Image]) -> None:
    y = row_index * CELL_SIZE
    for column, frame in enumerate(frames):
        atlas.paste(frame, (column * CELL_SIZE, y), frame)


def main() -> None:
    args = parse_args()
    closed = load_frame(args.closed, Image.new("RGBA", (CELL_SIZE, CELL_SIZE)))
    frames = [
        closed,
        load_frame(args.front_left, closed),
        load_frame(args.front_right, closed),
        load_frame(args.rear_left, closed),
        load_frame(args.rear_right, closed),
    ]

    atlas_path = Path(args.atlas)
    atlas = Image.open(atlas_path).convert("RGBA")
    if atlas.width != CELL_SIZE * DOOR_COLUMNS or atlas.height % CELL_SIZE != 0:
        raise SystemExit(
            f"{atlas_path} must be {CELL_SIZE * DOOR_COLUMNS} wide and row-aligned; got {atlas.size}."
        )

    existing_rows = atlas.height // CELL_SIZE
    row_index = args.row_index if args.row_index is not None else existing_rows
    if row_index < 0 or row_index > existing_rows:
        raise SystemExit(f"--row-index must be between 0 and {existing_rows}; got {row_index}.")

    if row_index == existing_rows:
        output = Image.new("RGBA", (atlas.width, atlas.height + CELL_SIZE), (0, 0, 0, 0))
        output.paste(atlas, (0, 0), atlas)
    else:
        output = atlas.copy()

    paste_row(output, row_index, frames)
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output.save(output_path)

    print(json.dumps({
        "atlas": str(output_path),
        "rowIndex": row_index,
        "presentationFrame": row_index,
        "rows": output.height // CELL_SIZE,
        "size": list(output.size),
        "doorFrames": {
            "closed": args.closed,
            "frontLeft": args.front_left or args.closed,
            "frontRight": args.front_right or args.closed,
            "rearLeft": args.rear_left or args.closed,
            "rearRight": args.rear_right or args.closed,
        }
    }, indent=2))


if __name__ == "__main__":
    main()
