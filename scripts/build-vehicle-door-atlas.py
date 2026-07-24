#!/usr/bin/env python3
"""Build NOCK0's vehicle door atlas from per-vehicle source frames."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from PIL import Image


CELL_SIZE = 96
FRAME_NAMES = ["closed", "front-left", "front-right", "rear-left", "rear-right"]
SOURCE_ROOT = Path("public/assets/custom/vehicles")
DEFAULT_OUTPUT = Path("public/assets/custom/actions/vehicle-doors.png")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Build public/assets/custom/actions/vehicle-doors.png from "
            "public/assets/custom/vehicles/<vehicle-id>/*.png source frames."
        )
    )
    parser.add_argument("--source-root", default=str(SOURCE_ROOT), help="Per-vehicle source frame root.")
    parser.add_argument("--output", default=str(DEFAULT_OUTPUT), help="Atlas output path.")
    parser.add_argument(
        "--allow-closed-fallback",
        action="store_true",
        help="Use closed.png when an open-door frame is missing."
    )
    parser.add_argument(
        "--manifest",
        help="Optional JSON path to write build metadata."
    )
    return parser.parse_args()


def manifest_order(source_root: Path) -> list[str]:
    entries: list[tuple[int, str]] = []
    for vehicle_dir in source_root.iterdir():
        manifest_path = vehicle_dir / "vehicle.json"
        if not vehicle_dir.is_dir() or not manifest_path.exists():
            continue
        manifest = json.loads(manifest_path.read_text())
        if manifest.get("status") != "ready":
            continue
        vehicle_id = manifest.get("id")
        atlas_row = manifest.get("presentation", {}).get("atlasRow")
        if not isinstance(vehicle_id, str) or not isinstance(atlas_row, int):
            raise SystemExit(f"{manifest_path} must define string id and integer presentation.atlasRow.")
        if vehicle_id != vehicle_dir.name:
            raise SystemExit(f"{manifest_path} id must match folder name {vehicle_dir.name}.")
        entries.append((atlas_row, vehicle_id))

    if not entries:
        raise SystemExit(f"No ready vehicle manifests found in {source_root}.")
    frames = sorted(frame for frame, _vehicle_id in entries)
    expected = list(range(len(entries)))
    if frames != expected:
        raise SystemExit(f"Vehicle presentation frames must be contiguous {expected}; got {frames}.")
    ordered = [vehicle_id for _frame, vehicle_id in sorted(entries)]
    if len(set(ordered)) != len(ordered):
        raise SystemExit(f"Duplicate vehicle ids in {source_root}: {ordered}.")
    return ordered


def load_frame(vehicle_dir: Path, frame_name: str, allow_closed_fallback: bool) -> Image.Image:
    path = vehicle_dir / f"{frame_name}.png"
    if not path.exists() and allow_closed_fallback and frame_name != "closed":
        path = vehicle_dir / "closed.png"
    if not path.exists():
        raise SystemExit(f"Missing vehicle frame: {vehicle_dir / f'{frame_name}.png'}")
    image = Image.open(path).convert("RGBA")
    if image.size != (CELL_SIZE, CELL_SIZE):
        raise SystemExit(f"{path} must be {CELL_SIZE}x{CELL_SIZE}; got {image.size}.")
    return image


def build_atlas(
    vehicle_ids: list[str],
    source_root: Path,
    allow_closed_fallback: bool,
) -> Image.Image:
    atlas = Image.new("RGBA", (CELL_SIZE * len(FRAME_NAMES), CELL_SIZE * len(vehicle_ids)), (0, 0, 0, 0))
    for row, vehicle_id in enumerate(vehicle_ids):
        vehicle_dir = source_root / vehicle_id
        if not vehicle_dir.is_dir():
            raise SystemExit(f"Missing vehicle source directory: {vehicle_dir}")
        for column, frame_name in enumerate(FRAME_NAMES):
            frame = load_frame(vehicle_dir, frame_name, allow_closed_fallback)
            atlas.paste(frame, (column * CELL_SIZE, row * CELL_SIZE))
    return atlas


def main() -> None:
    args = parse_args()
    source_root = Path(args.source_root)
    output_path = Path(args.output)
    vehicle_ids = manifest_order(source_root)
    atlas = build_atlas(vehicle_ids, source_root, args.allow_closed_fallback)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    atlas.save(output_path)

    metadata = {
        "cellSize": CELL_SIZE,
        "columns": len(FRAME_NAMES),
        "rows": len(vehicle_ids),
        "frames": FRAME_NAMES,
        "vehicles": vehicle_ids,
        "output": str(output_path),
        "sourceRoot": str(source_root),
    }
    if args.manifest:
        manifest_path = Path(args.manifest)
        manifest_path.parent.mkdir(parents=True, exist_ok=True)
        manifest_path.write_text(json.dumps(metadata, indent=2) + "\n")
    print(json.dumps(metadata, indent=2))


if __name__ == "__main__":
    main()
