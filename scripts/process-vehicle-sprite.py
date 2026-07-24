#!/usr/bin/env python3
"""Normalize generated or uploaded vehicle art into a 96px transparent source frame."""

from __future__ import annotations

import argparse
import json
import math
from collections import deque
from pathlib import Path

from PIL import Image


CELL_SIZE = 96
FIT_SCALE = 0.88


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--threshold", type=int, default=105)
    parser.add_argument("--edge-threshold", type=int, default=165)
    return parser.parse_args()


def magenta_distance(red: int, green: int, blue: int) -> float:
    return math.sqrt((red - 255) ** 2 + green**2 + (blue - 255) ** 2)


def remove_magenta(image: Image.Image, threshold: int, edge_threshold: int) -> Image.Image:
    image = image.convert("RGBA")
    pixels = image.load()
    width, height = image.size
    for x in range(width):
        for y in range(height):
            red, green, blue, alpha = pixels[x, y]
            if alpha and magenta_distance(red, green, blue) < threshold:
                pixels[x, y] = (0, 0, 0, 0)

    visited: set[tuple[int, int]] = set()
    queue: deque[tuple[int, int]] = deque()
    for x in range(width):
        queue.extend(((x, 0), (x, height - 1)))
    for y in range(height):
        queue.extend(((0, y), (width - 1, y)))
    while queue:
        x, y = queue.popleft()
        if (x, y) in visited or x < 0 or y < 0 or x >= width or y >= height:
            continue
        visited.add((x, y))
        red, green, blue, alpha = pixels[x, y]
        removable = alpha == 0 or magenta_distance(red, green, blue) < edge_threshold
        if not removable:
            continue
        pixels[x, y] = (0, 0, 0, 0)
        for offset_x in (-1, 0, 1):
            for offset_y in (-1, 0, 1):
                if offset_x or offset_y:
                    queue.append((x + offset_x, y + offset_y))
    return image


def largest_component_bbox(image: Image.Image) -> tuple[int, int, int, int] | None:
    alpha = image.getchannel("A")
    pixels = alpha.load()
    width, height = image.size
    visited = bytearray(width * height)
    largest_area = 0
    largest_bbox: tuple[int, int, int, int] | None = None
    for y in range(height):
        for x in range(width):
            start = y * width + x
            if visited[start] or pixels[x, y] == 0:
                continue
            queue: deque[tuple[int, int]] = deque([(x, y)])
            visited[start] = 1
            area = 0
            min_x = max_x = x
            min_y = max_y = y
            while queue:
                current_x, current_y = queue.popleft()
                area += 1
                min_x = min(min_x, current_x)
                min_y = min(min_y, current_y)
                max_x = max(max_x, current_x)
                max_y = max(max_y, current_y)
                for next_x, next_y in (
                    (current_x + 1, current_y),
                    (current_x - 1, current_y),
                    (current_x, current_y + 1),
                    (current_x, current_y - 1),
                ):
                    if not (0 <= next_x < width and 0 <= next_y < height):
                        continue
                    index = next_y * width + next_x
                    if visited[index] or pixels[next_x, next_y] == 0:
                        continue
                    visited[index] = 1
                    queue.append((next_x, next_y))
            if area > largest_area:
                largest_area = area
                largest_bbox = (min_x, min_y, max_x + 1, max_y + 1)
    return largest_bbox


def normalize(image: Image.Image) -> tuple[Image.Image, dict[str, object]]:
    bbox = largest_component_bbox(image)
    if bbox is None:
        raise SystemExit("No non-background vehicle pixels were found.")
    padding = max(2, round(max(image.size) * 0.012))
    padded = (
        max(0, bbox[0] - padding),
        max(0, bbox[1] - padding),
        min(image.width, bbox[2] + padding),
        min(image.height, bbox[3] + padding),
    )
    cropped = image.crop(padded)
    maximum = round(CELL_SIZE * FIT_SCALE)
    scale = min(maximum / cropped.width, maximum / cropped.height)
    output_size = (
        max(1, round(cropped.width * scale)),
        max(1, round(cropped.height * scale)),
    )
    resized = cropped.resize(output_size, Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (CELL_SIZE, CELL_SIZE), (0, 0, 0, 0))
    paste = ((CELL_SIZE - resized.width) // 2, (CELL_SIZE - resized.height) // 2)
    canvas.paste(resized, paste, resized)
    output_bbox = canvas.getbbox()
    if output_bbox is None:
        raise SystemExit("Processed vehicle frame is empty.")
    touches_edge = (
        output_bbox[0] <= 0
        or output_bbox[1] <= 0
        or output_bbox[2] >= CELL_SIZE
        or output_bbox[3] >= CELL_SIZE
    )
    if touches_edge:
        raise SystemExit("Processed vehicle touches the 96px frame edge.")
    return canvas, {
        "sourceSize": list(image.size),
        "sourceBbox": list(bbox),
        "outputSize": list(output_size),
        "outputBbox": list(output_bbox),
        "paste": list(paste),
        "touchesEdge": touches_edge,
    }


def main() -> None:
    args = parse_args()
    source = Image.open(args.input)
    cleaned = remove_magenta(source, args.threshold, args.edge_threshold)
    output, report = normalize(cleaned)
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output.save(output_path)
    report["input"] = str(args.input)
    report["output"] = str(output_path)
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
