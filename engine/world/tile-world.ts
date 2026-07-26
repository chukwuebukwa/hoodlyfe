/**
 * The single static collision representation: the district tile grid.
 * Semantics are identical to CollisionMap (server/world-map.ts): a tile is
 * blocked when its collision value is non-zero, and everything out of bounds
 * is intrinsically solid (which also covers Rapier's old border walls).
 */

import {traceGrid} from '../geometry/grid-trace';
import type {RayHit} from '../geometry/raycast';

export interface TileWorldGeometry {
  readonly width: number;
  readonly height: number;
  readonly tileWidth: number;
  readonly tileHeight: number;
  readonly collisions: readonly number[];
}

export interface TileWorld {
  readonly width: number;
  readonly height: number;
  readonly tileWidth: number;
  readonly tileHeight: number;
  readonly collisions: Uint8Array;
  readonly revision: number;
}

export function createTileWorld(geometry: TileWorldGeometry, revision = 0): TileWorld {
  const collisions = new Uint8Array(geometry.width * geometry.height);
  for (let index = 0; index < collisions.length; index++) {
    collisions[index] = geometry.collisions[index] !== 0 ? 1 : 0;
  }
  return {
    width: geometry.width,
    height: geometry.height,
    tileWidth: geometry.tileWidth,
    tileHeight: geometry.tileHeight,
    collisions,
    revision,
  };
}

export function isBlockedTile(world: TileWorld, col: number, row: number): boolean {
  if (col < 0 || row < 0 || col >= world.width || row >= world.height) return true;
  return world.collisions[row * world.width + col] !== 0;
}

/** CollisionMap.isBlockedAt-identical point test. */
export function isBlockedAt(world: TileWorld, x: number, y: number): boolean {
  return isBlockedTile(world, Math.floor(x / world.tileWidth), Math.floor(y / world.tileHeight));
}

/** Exact first-hit trace of a segment against blocked tiles. */
export function traceTiles(world: TileWorld, ax: number, ay: number, bx: number, by: number): RayHit | undefined {
  return traceGrid(
    ax,
    ay,
    bx,
    by,
    (col, row) => isBlockedTile(world, col, row),
    world.tileWidth,
    world.tileHeight
  );
}

/**
 * True when the tile face between (col,row) and its neighbor is interior —
 * both tiles blocked — so contact normals on that face should be culled
 * (prevents bodies catching on seams inside a solid wall run).
 */
export function isInteriorFace(world: TileWorld, col: number, row: number, faceNormalX: number, faceNormalY: number): boolean {
  const neighborCol = col + (faceNormalX > 0 ? 1 : faceNormalX < 0 ? -1 : 0);
  const neighborRow = row + (faceNormalY > 0 ? 1 : faceNormalY < 0 ? -1 : 0);
  return isBlockedTile(world, neighborCol, neighborRow);
}

/** Exact circle-vs-blocked-tile fit test (corners count; not point sampling). */
export function circleFitsInTiles(world: TileWorld, x: number, y: number, radius: number): boolean {
  if (isBlockedAt(world, x, y)) return false;
  const startCol = Math.floor((x - radius) / world.tileWidth);
  const endCol = Math.floor((x + radius) / world.tileWidth);
  const startRow = Math.floor((y - radius) / world.tileHeight);
  const endRow = Math.floor((y + radius) / world.tileHeight);
  for (let row = startRow; row <= endRow; row++) {
    for (let col = startCol; col <= endCol; col++) {
      if (!isBlockedTile(world, col, row)) continue;
      const minX = col * world.tileWidth;
      const minY = row * world.tileHeight;
      const nearestX = x < minX ? minX : x > minX + world.tileWidth ? minX + world.tileWidth : x;
      const nearestY = y < minY ? minY : y > minY + world.tileHeight ? minY + world.tileHeight : y;
      const dx = x - nearestX;
      const dy = y - nearestY;
      if (dx * dx + dy * dy < radius * radius) return false;
    }
  }
  return true;
}

/** Enumerate blocked tiles overlapping an AABB (in tile indices, row-major order). */
export function blockedTilesInAabb(
  world: TileWorld,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number
): Array<{col: number; row: number}> {
  const result: Array<{col: number; row: number}> = [];
  const startCol = Math.floor(minX / world.tileWidth);
  const endCol = Math.floor(maxX / world.tileWidth);
  const startRow = Math.floor(minY / world.tileHeight);
  const endRow = Math.floor(maxY / world.tileHeight);
  for (let row = startRow; row <= endRow; row++) {
    for (let col = startCol; col <= endCol; col++) {
      if (isBlockedTile(world, col, row)) result.push({col, row});
    }
  }
  return result;
}
