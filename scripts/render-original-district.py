#!/usr/bin/env python3
"""Build an original visual district from the authoritative road/collision grids."""

from __future__ import annotations

import hashlib
import json
import math
from collections import deque
from pathlib import Path
import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFilter


ROOT = Path(__file__).resolve().parents[1]
SOURCE_DIR = ROOT / "public" / "assets" / "maps"
OUTPUT_DIR = ROOT / "public" / "assets" / "original" / "maps"
MATERIAL_ATLAS = ROOT / "art" / "source" / "map-materials.png"
PROP_DIR = ROOT / "public" / "assets" / "original" / "map-props"
SEED = "nock0-original-district-v1"

MATERIAL_KEYS = (
    "asphalt",
    "sidewalk",
    "grass",
    "brick",
    "gravel",
    "metal",
    "tar",
    "concrete",
)

BASE_COLORS = {
    "asphalt": (55, 65, 67),
    "sidewalk": (126, 137, 136),
    "grass": (57, 86, 61),
    "brick": (123, 76, 67),
    "gravel": (91, 96, 98),
    "metal": (69, 88, 91),
    "tar": (57, 58, 62),
    "concrete": (106, 106, 101),
}


def stable_int(*parts: object) -> int:
    value = ":".join(str(part) for part in (SEED, *parts)).encode("utf-8")
    return int.from_bytes(hashlib.blake2b(value, digest_size=8).digest(), "big")


def layer_data(game_map: dict, name: str) -> np.ndarray:
    layer = next(layer for layer in game_map["layers"] if layer["name"] == name)
    return np.asarray(layer["data"], dtype=np.uint8).reshape(game_map["height"], game_map["width"])


def connected_components(mask: np.ndarray) -> tuple[np.ndarray, list[list[tuple[int, int]]]]:
    height, width = mask.shape
    labels = np.full((height, width), -1, dtype=np.int32)
    components: list[list[tuple[int, int]]] = []

    for row in range(height):
        for column in range(width):
            if not mask[row, column] or labels[row, column] >= 0:
                continue
            component_id = len(components)
            queue = deque([(column, row)])
            labels[row, column] = component_id
            cells: list[tuple[int, int]] = []
            while queue:
                x, y = queue.popleft()
                cells.append((x, y))
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    nx, ny = x + dx, y + dy
                    if 0 <= nx < width and 0 <= ny < height and mask[ny, nx] and labels[ny, nx] < 0:
                        labels[ny, nx] = component_id
                        queue.append((nx, ny))
            components.append(cells)
    return labels, components


class MaterialKit:
    def __init__(self, tile_size: int) -> None:
        self.tile_size = tile_size
        self.atlas_tiles = self._load_atlas()
        self.cache: dict[tuple[str, int], Image.Image] = {}

    def _load_atlas(self) -> dict[str, Image.Image]:
        if not MATERIAL_ATLAS.exists():
            return {}
        atlas = Image.open(MATERIAL_ATLAS).convert("RGB")
        result: dict[str, Image.Image] = {}
        for index, key in enumerate(MATERIAL_KEYS):
            row, column = divmod(index, 4)
            left = round(column * atlas.width / 4)
            right = round((column + 1) * atlas.width / 4)
            top = round(row * atlas.height / 2)
            bottom = round((row + 1) * atlas.height / 2)
            margin_x = max(1, round((right - left) * 0.08))
            margin_y = max(1, round((bottom - top) * 0.08))
            result[key] = atlas.crop((
                left + margin_x,
                top + margin_y,
                right - margin_x,
                bottom - margin_y,
            )).resize(
                (self.tile_size, self.tile_size), Image.Resampling.LANCZOS
            )
        return result

    def tile(self, kind: str, variant: int) -> Image.Image:
        cache_key = (kind, variant % 8)
        cached = self.cache.get(cache_key)
        if cached is not None:
            return cached

        if kind in self.atlas_tiles:
            tile = ImageChops.offset(
                self.atlas_tiles[kind],
                (variant * 11) % self.tile_size,
                (variant * 17) % self.tile_size,
            )
            tile = self._finish(tile, kind, variant, 5)
        else:
            tile = self._procedural(kind, variant)
        self.cache[cache_key] = tile
        return tile

    def _procedural(self, kind: str, variant: int) -> Image.Image:
        size = self.tile_size
        rng = np.random.default_rng(stable_int("material", kind, variant))
        base = np.asarray(BASE_COLORS[kind], dtype=np.int16)
        variance = 12 if kind in {"grass", "gravel", "brick"} else 7
        noise = rng.normal(0, variance, (size, size, 1))
        pixels = np.clip(base + noise, 0, 255).astype(np.uint8)
        tile = Image.fromarray(pixels).filter(ImageFilter.GaussianBlur(0.35))
        return self._finish(tile, kind, variant, variance)

    def _finish(self, tile: Image.Image, kind: str, variant: int, variance: int) -> Image.Image:
        draw = ImageDraw.Draw(tile, "RGBA")
        size = self.tile_size
        rng = np.random.default_rng(stable_int("finish", kind, variant))

        if kind == "sidewalk":
            for y in range(-8, size + 8, 12):
                offset = 8 if (y // 12) % 2 else 0
                draw.line((0, y, size, y), fill=(48, 60, 62, 80), width=1)
                for x in range(-offset, size + 12, 16):
                    draw.line((x, y, x, y + 12), fill=(54, 65, 66, 65), width=1)
        elif kind == "grass":
            for _ in range(90):
                x = int(rng.integers(0, size))
                y = int(rng.integers(0, size))
                color = (88, 124, 69, 90) if rng.random() > 0.45 else (30, 62, 43, 100)
                draw.point((x, y), fill=color)
        elif kind == "brick":
            for y in range(0, size, 9):
                draw.line((0, y, size, y), fill=(45, 34, 34, 80), width=1)
                offset = 8 if (y // 9) % 2 else 0
                for x in range(-offset, size, 16):
                    draw.line((x, y, x, min(size, y + 9)), fill=(45, 34, 34, 70), width=1)
        elif kind == "metal":
            for x in range(0, size, 8):
                draw.line((x, 0, x, size), fill=(20, 34, 37, 95), width=2)
                draw.line((x + 2, 0, x + 2, size), fill=(132, 154, 151, 45), width=1)
        elif kind == "tar":
            for y in range(0, size, 16):
                draw.line((0, y, size, y), fill=(12, 14, 16, 85), width=2)
            for x in range((variant % 3) * 9, size, 24):
                draw.line((x, 0, x, size), fill=(16, 18, 20, 50), width=1)
        elif kind == "concrete":
            for y in range(16, size, 24):
                draw.line((0, y, size, y), fill=(54, 57, 57, 55), width=1)
            draw.line((size // 2, 0, size // 2, size), fill=(54, 57, 57, 45), width=1)
        elif kind == "gravel":
            for _ in range(140):
                x = int(rng.integers(0, size))
                y = int(rng.integers(0, size))
                value = int(rng.integers(55, 135))
                draw.point((x, y), fill=(value, value, value, 105))
        elif kind == "asphalt":
            for _ in range(34):
                x = int(rng.integers(0, size))
                y = int(rng.integers(0, size))
                draw.point((x, y), fill=(118, 125, 118, int(rng.integers(20, 70))))
        return tile


class PropKit:
    def __init__(self) -> None:
        self.props: dict[str, Image.Image] = {}
        if not PROP_DIR.exists():
            return
        for path in PROP_DIR.glob("*.png"):
            self.props[path.stem] = Image.open(path).convert("RGBA")

    def paste(self, image: Image.Image, name: str, center_x: int, center_y: int) -> bool:
        prop = self.props.get(name)
        if prop is None:
            return False
        image.paste(prop, (center_x - prop.width // 2, center_y - prop.height // 2), prop)
        return True


class DistrictRenderer:
    def __init__(self, game_map: dict, metadata: dict) -> None:
        self.game_map = game_map
        self.metadata = metadata
        self.width = int(game_map["width"])
        self.height = int(game_map["height"])
        self.tile_size = int(game_map["tilewidth"])
        self.pixel_width = self.width * self.tile_size
        self.pixel_height = self.height * self.tile_size
        self.roads = layer_data(game_map, "roads") > 0
        self.blocked = layer_data(game_map, "collisions") > 0
        self.component_ids, self.components = connected_components(self.blocked)
        self.component_materials = [
            ("brick", "gravel", "metal", "tar", "concrete")[stable_int("component", index) % 5]
            for index in range(len(self.components))
        ]
        self.surface_kinds = np.empty((self.height, self.width), dtype=object)
        self.materials = MaterialKit(self.tile_size)
        self.props = PropKit()

    def render(self) -> tuple[Image.Image, Image.Image]:
        base = Image.new("RGB", (self.pixel_width, self.pixel_height), BASE_COLORS["sidewalk"])
        overlay = Image.new("RGBA", base.size, (0, 0, 0, 0))

        self._paint_surfaces(base)
        self._draw_surface_transitions(base)
        self._draw_roads(base)
        self._draw_buildings(base)
        self._draw_ground_props(base)
        self._draw_overlay(overlay)
        return base, overlay

    def _paint_surfaces(self, image: Image.Image) -> None:
        for row in range(self.height):
            for column in range(self.width):
                if self.roads[row, column]:
                    material = "asphalt"
                elif self.blocked[row, column]:
                    material = self.component_materials[self.component_ids[row, column]]
                else:
                    road_neighbors = self._neighbor_count(self.roads, column, row)
                    value = stable_int("open-material", column, row)
                    if road_neighbors == 0 and value % 13 in {0, 1}:
                        material = "grass"
                    elif road_neighbors == 0 and value % 7 == 0:
                        material = "concrete"
                    else:
                        material = "sidewalk"
                variant = stable_int("tile", material, column, row) % 8
                self.surface_kinds[row, column] = material
                image.paste(
                    self.materials.tile(material, variant),
                    (column * self.tile_size, row * self.tile_size),
                )

    def _draw_surface_transitions(self, image: Image.Image) -> None:
        draw = ImageDraw.Draw(image, "RGBA")
        tile = self.tile_size
        for row in range(self.height):
            for column in range(self.width):
                if self.surface_kinds[row, column] != "grass":
                    continue
                x0, y0 = column * tile, row * tile
                x1, y1 = x0 + tile, y0 + tile
                for dx, dy, edge in (
                    (0, -1, "north"), (1, 0, "east"), (0, 1, "south"), (-1, 0, "west")
                ):
                    nx, ny = column + dx, row + dy
                    neighbor_grass = (
                        0 <= nx < self.width and 0 <= ny < self.height and
                        self.surface_kinds[ny, nx] == "grass"
                    )
                    if neighbor_grass:
                        continue
                    if edge == "north":
                        draw.line((x0, y0, x1, y0), fill=(34, 47, 36, 230), width=5)
                        draw.line((x0, y0 + 5, x1, y0 + 5), fill=(128, 133, 108, 145), width=2)
                    elif edge == "south":
                        draw.line((x0, y1, x1, y1), fill=(34, 47, 36, 230), width=5)
                        draw.line((x0, y1 - 5, x1, y1 - 5), fill=(128, 133, 108, 145), width=2)
                    elif edge == "west":
                        draw.line((x0, y0, x0, y1), fill=(34, 47, 36, 230), width=5)
                        draw.line((x0 + 5, y0, x0 + 5, y1), fill=(128, 133, 108, 145), width=2)
                    else:
                        draw.line((x1, y0, x1, y1), fill=(34, 47, 36, 230), width=5)
                        draw.line((x1 - 5, y0, x1 - 5, y1), fill=(128, 133, 108, 145), width=2)

    def _draw_roads(self, image: Image.Image) -> None:
        draw = ImageDraw.Draw(image, "RGBA")
        tile = self.tile_size
        yellow = (222, 174, 54, 220)
        white = (219, 221, 207, 180)

        for row in range(self.height):
            for column in range(self.width):
                if not self.roads[row, column]:
                    continue
                x0, y0 = column * tile, row * tile
                x1, y1 = x0 + tile, y0 + tile

                for dx, dy, edge in (
                    (0, -1, "north"),
                    (1, 0, "east"),
                    (0, 1, "south"),
                    (-1, 0, "west"),
                ):
                    if self._get(self.roads, column + dx, row + dy):
                        continue
                    if edge == "north":
                        draw.line((x0, y0 + 1, x1, y0 + 1), fill=(26, 31, 32, 210), width=4)
                        draw.line((x0, y0 + 5, x1, y0 + 5), fill=(170, 176, 161, 165), width=2)
                    elif edge == "south":
                        draw.line((x0, y1 - 1, x1, y1 - 1), fill=(26, 31, 32, 210), width=4)
                        draw.line((x0, y1 - 6, x1, y1 - 6), fill=(170, 176, 161, 165), width=2)
                    elif edge == "west":
                        draw.line((x0 + 1, y0, x0 + 1, y1), fill=(26, 31, 32, 210), width=4)
                        draw.line((x0 + 5, y0, x0 + 5, y1), fill=(170, 176, 161, 165), width=2)
                    else:
                        draw.line((x1 - 1, y0, x1 - 1, y1), fill=(26, 31, 32, 210), width=4)
                        draw.line((x1 - 6, y0, x1 - 6, y1), fill=(170, 176, 161, 165), width=2)

                horizontal = self._span(self.roads, column, row, 1, 0)
                vertical = self._span(self.roads, column, row, 0, 1)
                if max(horizontal, vertical) < 3:
                    continue
                if horizontal > vertical:
                    draw.line((x0 + 18, y0 + tile // 2, x0 + 42, y0 + tile // 2), fill=yellow, width=3)
                    if row % 2 == 0:
                        draw.line((x0 + 12, y0 + 10, x0 + 28, y0 + 10), fill=white, width=2)
                elif vertical > horizontal:
                    draw.line((x0 + tile // 2, y0 + 18, x0 + tile // 2, y0 + 42), fill=yellow, width=3)
                    if column % 2 == 0:
                        draw.line((x0 + 10, y0 + 12, x0 + 10, y0 + 28), fill=white, width=2)
                elif stable_int("crosswalk", column, row) % 11 == 0:
                    for offset in range(10, 55, 9):
                        draw.rectangle((x0 + offset, y0 + 4, x0 + offset + 4, y0 + 22), fill=white)

                detail = stable_int("road-detail", column, row)
                if detail % 17 == 0:
                    self._draw_manhole(image, draw, x0 + 20 + detail % 24, y0 + 20 + (detail // 7) % 24)
                elif detail % 23 == 0:
                    self._draw_crack(draw, x0 + 8, y0 + 12, detail)

    def _draw_buildings(self, image: Image.Image) -> None:
        draw = ImageDraw.Draw(image, "RGBA")
        tile = self.tile_size

        for row in range(self.height):
            for column in range(self.width):
                if not self.blocked[row, column]:
                    continue
                x0, y0 = column * tile, row * tile
                x1, y1 = x0 + tile, y0 + tile
                component_id = int(self.component_ids[row, column])
                material = self.component_materials[component_id]
                edge_dark = (24, 29, 30, 225)
                edge_mid = (81, 91, 89, 235)
                edge_light = (177, 163, 134, 180) if material == "brick" else (149, 160, 153, 170)

                for dx, dy, edge in (
                    (0, -1, "north"),
                    (1, 0, "east"),
                    (0, 1, "south"),
                    (-1, 0, "west"),
                ):
                    if self._get(self.blocked, column + dx, row + dy):
                        continue
                    if edge == "north":
                        draw.rectangle((x0, y0, x1, y0 + 8), fill=edge_dark)
                        draw.line((x0, y0 + 9, x1, y0 + 9), fill=edge_light, width=2)
                    elif edge == "south":
                        draw.rectangle((x0, y1 - 9, x1, y1), fill=edge_dark)
                        draw.line((x0, y1 - 10, x1, y1 - 10), fill=edge_mid, width=2)
                        draw.rectangle((x0 + 4, y1, x1 + 7, y1 + 7), fill=(8, 10, 11, 90))
                    elif edge == "west":
                        draw.rectangle((x0, y0, x0 + 8, y1), fill=edge_dark)
                        draw.line((x0 + 9, y0, x0 + 9, y1), fill=edge_light, width=2)
                    else:
                        draw.rectangle((x1 - 9, y0, x1, y1), fill=edge_dark)
                        draw.line((x1 - 10, y0, x1 - 10, y1), fill=edge_mid, width=2)
                        draw.rectangle((x1, y0 + 4, x1 + 7, y1 + 7), fill=(8, 10, 11, 75))

                interior = all(
                    self._get(self.blocked, column + dx, row + dy)
                    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))
                )
                prop_seed = stable_int("roof-prop", component_id, column, row)
                if interior and prop_seed % 7 == 0:
                    self._draw_roof_prop(image, draw, x0, y0, prop_seed)
                elif len(self.components[component_id]) <= 3 and prop_seed % 3 == 0:
                    self._draw_roof_prop(image, draw, x0, y0, prop_seed)

    def _draw_ground_props(self, image: Image.Image) -> None:
        draw = ImageDraw.Draw(image, "RGBA")
        tile = self.tile_size
        for row in range(self.height):
            for column in range(self.width):
                if self.roads[row, column] or self.blocked[row, column]:
                    continue
                x0, y0 = column * tile, row * tile
                value = stable_int("ground-prop", column, row)
                road_neighbors = self._neighbor_count(self.roads, column, row)
                if road_neighbors >= 1 and value % 31 == 0:
                    cx, cy = x0 + 49, y0 + 29
                    draw.ellipse((cx - 4, cy - 4, cx + 4, cy + 4), fill=(32, 43, 43, 245))
                    draw.line((cx, cy, cx + 12, cy - 5), fill=(48, 62, 61, 235), width=3)
                    draw.ellipse((cx + 8, cy - 10, cx + 17, cy - 1), fill=(177, 181, 156, 210), outline=(43, 55, 54, 235), width=2)
                elif road_neighbors == 0 and value % 37 == 0:
                    if not self.props.paste(image, "planter", x0 + 32, y0 + 31):
                        self._draw_planter(draw, x0 + 18, y0 + 19, value)

                if road_neighbors >= 1 and value % 73 == 0:
                    self.props.paste(image, "dumpster", x0 + 31, y0 + 34)
                elif road_neighbors == 0 and value % 79 == 0:
                    self.props.paste(image, "stairs", x0 + 32, y0 + 34)
                elif road_neighbors >= 1 and value % 83 == 0:
                    self.props.paste(image, "utility-box", x0 + 34, y0 + 33)

                if road_neighbors >= 1 and value % 97 == 0:
                    self.props.paste(image, "traffic-barrier", x0 + 32, y0 + 37)

                if road_neighbors >= 2 and value % 19 == 0:
                    for offset in (10, 30, 50):
                        draw.line((x0 + offset, y0 + 46, x0 + offset + 10, y0 + 58), fill=(224, 224, 205, 145), width=2)

    def _draw_overlay(self, overlay: Image.Image) -> None:
        draw = ImageDraw.Draw(overlay, "RGBA")
        tile = self.tile_size
        candidates: list[tuple[int, int, int, str]] = []

        for row in range(1, self.height - 1):
            for column in range(1, self.width - 1):
                if not self.roads[row, column]:
                    continue
                horizontal = self._span(self.roads, column, row, 1, 0)
                vertical = self._span(self.roads, column, row, 0, 1)
                if max(horizontal, vertical) < 5:
                    continue
                direction = "horizontal" if horizontal > vertical else "vertical"
                candidates.append((stable_int("gantry", column, row), column, row, direction))

        for _, column, row, direction in sorted(candidates)[:10]:
            cx = column * tile + tile // 2
            cy = row * tile + tile // 2
            if direction == "horizontal":
                self._draw_truss(draw, cx, cy - tile // 2, cx, cy + tile // 2)
            else:
                self._draw_truss(draw, cx - tile // 2, cy, cx + tile // 2, cy)

        poles: list[tuple[int, int]] = []
        for row in range(1, self.height - 1):
            for column in range(1, self.width - 1):
                if self.roads[row, column] or self.blocked[row, column]:
                    continue
                if self._neighbor_count(self.roads, column, row) == 0:
                    continue
                if stable_int("utility-pole", column, row) % 83 == 0:
                    poles.append((column * tile + tile // 2, row * tile + tile // 2))
        poles = sorted(poles, key=lambda point: (point[1], point[0]))[:24]
        for index in range(0, len(poles) - 1, 2):
            x1, y1 = poles[index]
            x2, y2 = poles[index + 1]
            if math.hypot(x2 - x1, y2 - y1) > 620:
                continue
            draw.line((x1, y1, x2, y2), fill=(19, 27, 29, 185), width=2)
            draw.line((x1 + 2, y1, x2 + 2, y2), fill=(79, 93, 91, 70), width=1)
        for x, y in poles:
            draw.ellipse((x - 4, y - 4, x + 4, y + 4), fill=(34, 47, 48, 245))
            draw.line((x - 9, y, x + 9, y), fill=(44, 62, 61, 235), width=3)

        fence_candidates: list[tuple[int, int, str]] = []
        for row in range(self.height):
            for column in range(self.width):
                if self.roads[row, column] or self.blocked[row, column]:
                    continue
                if stable_int("fence", column, row) % 101 != 0:
                    continue
                if self._get(self.roads, column, row - 1) or self._get(self.roads, column, row + 1):
                    fence_candidates.append((column * tile + 32, row * tile + 32, "horizontal"))
                elif self._get(self.roads, column - 1, row) or self._get(self.roads, column + 1, row):
                    fence_candidates.append((column * tile + 32, row * tile + 32, "vertical"))
        fence = self.props.props.get("fence")
        for x, y, direction in fence_candidates[:18]:
            if fence is not None:
                placed = fence if direction == "horizontal" else fence.rotate(90, expand=True, resample=Image.Resampling.BICUBIC)
                overlay.paste(placed, (x - placed.width // 2, y - placed.height // 2), placed)
            elif direction == "horizontal":
                draw.line((x - 28, y, x + 28, y), fill=(73, 91, 89, 220), width=3)
                for offset in range(-28, 29, 9):
                    draw.line((x + offset, y - 5, x + offset, y + 5), fill=(39, 53, 53, 230), width=2)
            else:
                draw.line((x, y - 28, x, y + 28), fill=(73, 91, 89, 220), width=3)
                for offset in range(-28, 29, 9):
                    draw.line((x - 5, y + offset, x + 5, y + offset), fill=(39, 53, 53, 230), width=2)

        if self.components:
            largest = max(self.components, key=len)
            min_x = min(cell[0] for cell in largest) * tile
            max_x = (max(cell[0] for cell in largest) + 1) * tile
            min_y = min(cell[1] for cell in largest) * tile
            mast_x = max_x - 18
            mast_y = min_y + 24
            arm_end = min(self.pixel_width - 32, mast_x + 300)
            self._draw_truss(draw, mast_x, mast_y, mast_x, min(self.pixel_height - 24, mast_y + 360), hazard=True)
            self._draw_truss(draw, mast_x, mast_y + 22, arm_end, mast_y + 22)
            draw.line((arm_end - 18, mast_y + 22, arm_end - 18, mast_y + 122), fill=(34, 41, 42, 210), width=2)
            draw.rectangle((arm_end - 24, mast_y + 118, arm_end - 12, mast_y + 130), fill=(188, 151, 47, 230))

    def _draw_roof_prop(self, image: Image.Image, draw: ImageDraw.ImageDraw, x0: int, y0: int, value: int) -> None:
        kind = value % 8
        cx = x0 + 32 + (value % 9) - 4
        cy = y0 + 32 + ((value // 11) % 9) - 4
        names = (
            "hvac", "skylight", "vent", "solar-panel", "roof-tank", "antenna", "pipework", "roof-exhaust"
        )
        if self.props.paste(image, names[kind], cx, cy):
            return
        if kind == 0:
            draw.rectangle((cx - 15, cy - 15, cx + 15, cy + 15), fill=(35, 43, 44, 235), outline=(139, 145, 135, 210), width=2)
            draw.ellipse((cx - 11, cy - 11, cx + 11, cy + 11), fill=(19, 26, 27, 255), outline=(170, 175, 163, 190), width=2)
            for angle in range(0, 360, 45):
                radians = math.radians(angle)
                draw.line((cx, cy, cx + math.cos(radians) * 9, cy + math.sin(radians) * 9), fill=(96, 110, 107, 230), width=2)
        elif kind == 1:
            draw.rectangle((cx - 15, cy - 10, cx + 15, cy + 10), fill=(39, 67, 75, 235), outline=(164, 185, 180, 220), width=2)
            draw.line((cx - 10, cy - 6, cx + 10, cy + 6), fill=(183, 209, 201, 120), width=2)
        elif kind == 2:
            draw.rectangle((cx - 11, cy - 12, cx + 11, cy + 12), fill=(61, 72, 70, 255), outline=(25, 31, 32, 240), width=2)
            for offset in range(-7, 8, 5):
                draw.line((cx - 7, cy + offset, cx + 7, cy + offset), fill=(132, 145, 137, 160), width=1)
        elif kind == 3:
            for row in range(2):
                for column in range(2):
                    left = cx - 17 + column * 18
                    top = cy - 13 + row * 14
                    draw.rectangle((left, top, left + 15, top + 11), fill=(26, 50, 62, 245), outline=(100, 130, 134, 180), width=1)
        elif kind == 4:
            draw.ellipse((cx - 12, cy - 8, cx + 12, cy + 8), fill=(85, 90, 85, 245), outline=(28, 32, 31, 240), width=2)
            draw.rectangle((cx - 12, cy - 4, cx + 12, cy + 6), fill=(76, 82, 78, 245))

        elif kind == 5:
            draw.line((cx, cy + 12, cx, cy - 13), fill=(35, 43, 44, 245), width=3)
            draw.ellipse((cx - 10, cy - 11, cx + 10, cy + 1), outline=(143, 155, 150, 220), width=2)
            draw.line((cx, cy - 5, cx + 9, cy - 14), fill=(90, 108, 105, 220), width=2)
        elif kind == 6:
            draw.line((cx - 14, cy + 8, cx + 10, cy + 8), fill=(54, 65, 64, 245), width=5)
            draw.line((cx + 10, cy + 8, cx + 10, cy - 10), fill=(54, 65, 64, 245), width=5)
            draw.ellipse((cx + 5, cy - 15, cx + 15, cy - 5), fill=(85, 98, 95, 245))
        else:
            draw.rectangle((cx - 8, cy - 10, cx + 8, cy + 11), fill=(61, 70, 68, 245), outline=(30, 36, 36, 235), width=2)
            draw.ellipse((cx - 8, cy - 15, cx + 8, cy - 4), fill=(103, 113, 107, 245), outline=(36, 43, 42, 230), width=2)

    def _draw_manhole(self, image: Image.Image, draw: ImageDraw.ImageDraw, cx: int, cy: int) -> None:
        if self.props.paste(image, "manhole", cx, cy):
            return
        draw.ellipse((cx - 8, cy - 8, cx + 8, cy + 8), fill=(27, 32, 33, 210), outline=(112, 119, 113, 155), width=2)
        draw.line((cx - 5, cy, cx + 5, cy), fill=(103, 111, 106, 130), width=1)
        draw.line((cx, cy - 5, cx, cy + 5), fill=(103, 111, 106, 130), width=1)

    @staticmethod
    def _draw_crack(draw: ImageDraw.ImageDraw, x: int, y: int, value: int) -> None:
        points = [(x, y)]
        for index in range(1, 6):
            points.append((x + index * 8, y + ((value >> (index * 3)) % 13) - 6))
        draw.line(points, fill=(21, 27, 28, 120), width=2)

    @staticmethod
    def _draw_planter(draw: ImageDraw.ImageDraw, x: int, y: int, value: int) -> None:
        draw.rectangle((x, y, x + 28, y + 22), fill=(73, 68, 58, 245), outline=(35, 38, 36, 220), width=2)
        for index in range(9):
            px = x + 5 + (stable_int("plant-x", value, index) % 19)
            py = y + 4 + (stable_int("plant-y", value, index) % 13)
            draw.ellipse((px - 3, py - 3, px + 3, py + 3), fill=(61, 111, 67, 220))

    @staticmethod
    def _draw_truss(
        draw: ImageDraw.ImageDraw,
        x1: int,
        y1: int,
        x2: int,
        y2: int,
        hazard: bool = False,
    ) -> None:
        color = (39, 57, 58, 245)
        highlight = (105, 126, 119, 175)
        draw.line((x1, y1, x2, y2), fill=color, width=8)
        draw.line((x1, y1, x2, y2), fill=highlight, width=2)
        length = max(1, int(math.hypot(x2 - x1, y2 - y1)))
        steps = max(1, length // 22)
        dx = (x2 - x1) / steps
        dy = (y2 - y1) / steps
        normal_x = -dy / max(1, length) * 8
        normal_y = dx / max(1, length) * 8
        for index in range(steps):
            ax, ay = x1 + dx * index, y1 + dy * index
            bx, by = x1 + dx * (index + 1), y1 + dy * (index + 1)
            draw.line((ax - normal_x, ay - normal_y, bx + normal_x, by + normal_y), fill=color, width=2)
            draw.line((ax + normal_x, ay + normal_y, bx - normal_x, by - normal_y), fill=color, width=2)
        if hazard:
            for index in range(0, length, 18):
                ratio = index / length
                x = x1 + (x2 - x1) * ratio
                y = y1 + (y2 - y1) * ratio
                draw.ellipse((x - 4, y - 4, x + 4, y + 4), fill=(220, 165, 40, 230))

    def _neighbor_count(self, mask: np.ndarray, column: int, row: int) -> int:
        return sum(
            self._get(mask, column + dx, row + dy)
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))
        )

    def _span(self, mask: np.ndarray, column: int, row: int, dx: int, dy: int) -> int:
        count = 1
        x, y = column + dx, row + dy
        while self._get(mask, x, y):
            count += 1
            x, y = x + dx, y + dy
        x, y = column - dx, row - dy
        while self._get(mask, x, y):
            count += 1
            x, y = x - dx, y - dy
        return count

    @staticmethod
    def _get(mask: np.ndarray, column: int, row: int) -> bool:
        return 0 <= row < mask.shape[0] and 0 <= column < mask.shape[1] and bool(mask[row, column])


def write_runtime_map(game_map: dict, metadata: dict) -> None:
    runtime_map = json.loads(json.dumps(game_map))
    for layer in runtime_map["layers"]:
        if layer["name"] == "ground":
            layer["data"] = [0] * (runtime_map["width"] * runtime_map["height"])
        elif layer["name"] in {"collisions", "roads"}:
            layer["data"] = [1 if value else 0 for value in layer["data"]]
    runtime_map["tilesets"] = [{
        "columns": 1,
        "firstgid": 1,
        "image": "district-tiles.png",
        "imageheight": runtime_map["tileheight"],
        "imagewidth": runtime_map["tilewidth"],
        "margin": 0,
        "name": "district",
        "spacing": 0,
        "tilecount": 1,
        "tileheight": runtime_map["tileheight"],
        "tilewidth": runtime_map["tilewidth"],
    }]

    runtime_metadata = dict(metadata)
    runtime_metadata["source"] = "nock0-original-semantic-v1"
    runtime_metadata["visualPipeline"] = {
        "renderer": "scripts/render-original-district.py",
        "materials": list(MATERIAL_KEYS),
        "props": [
            "curbs", "crosswalks", "lane-paint", "parking-bays", "manholes", "cracks",
            "parapets", "hvac-fans", "skylights", "vents", "solar-panels", "roof-tanks",
            "planters", "dumpsters", "stairs", "fences", "streetlights", "utility-boxes",
            "traffic-barriers", "utility-lines", "antennas", "pipework", "roof-exhausts",
            "gantries", "trusses", "crane",
        ],
    }

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUTPUT_DIR / "district-map.json").write_text(json.dumps(runtime_map, separators=(",", ":")), encoding="utf-8")
    (OUTPUT_DIR / "district-map.metadata.json").write_text(json.dumps(runtime_metadata, indent=2), encoding="utf-8")
    Image.new("RGBA", (runtime_map["tilewidth"], runtime_map["tileheight"]), (0, 0, 0, 0)).save(
        OUTPUT_DIR / "district-tiles.png", optimize=True
    )


def main() -> None:
    source_map_path = SOURCE_DIR / "district-map.json"
    source_metadata_path = SOURCE_DIR / "district-map.metadata.json"
    if not source_map_path.exists() or not source_metadata_path.exists():
        raise SystemExit("Run npm run assets:export once to provide the semantic source map.")

    game_map = json.loads(source_map_path.read_text(encoding="utf-8"))
    metadata = json.loads(source_metadata_path.read_text(encoding="utf-8"))
    renderer = DistrictRenderer(game_map, metadata)
    preview, overlay = renderer.render()

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    preview.save(OUTPUT_DIR / "district-preview.png", optimize=True)
    overlay.save(OUTPUT_DIR / "district-overlay.png", optimize=True)
    write_runtime_map(game_map, metadata)
    print(f"Rendered {preview.width}x{preview.height} original district to {OUTPUT_DIR}")


if __name__ == "__main__":
    main()
