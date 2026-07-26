/**
 * Unified spatial queries over statics (tile world) + dynamics (WorldState).
 * All results are deterministic: body hits are resolved in id-sorted order and
 * overlap results are returned id-sorted.
 */

import type {EngineBody, WorldState} from '../core/types';
import {shapesOverlap, shapeAabb, type PosedShape} from '../geometry/overlap';
import {segmentVsBox, segmentVsCircle, type RayHit} from '../geometry/raycast';
import {buildBroadphase, queryBroadphase, type Broadphase} from './broadphase';
import {isBlockedAt, traceTiles, type TileWorld} from './tile-world';
import {posedShape} from './world-state';

export interface QueryFilter {
  /** Only bodies whose layer intersects this mask are considered. */
  mask?: number;
  /** Body ids to skip (e.g. the querying entity itself). */
  exclude?: readonly string[];
  /** When false, the tile world is ignored. Default true. */
  includeStatics?: boolean;
}

export interface WorldRayHit extends RayHit {
  /** Undefined when the hit is against the static tile world. */
  bodyId?: string;
}

function passesFilter(body: EngineBody, filter?: QueryFilter): boolean {
  if (filter?.mask !== undefined && (body.layer & filter.mask) === 0) return false;
  if (filter?.exclude && filter.exclude.includes(body.id)) return false;
  return true;
}

function segmentVsBody(ax: number, ay: number, bx: number, by: number, body: EngineBody): RayHit | undefined {
  const shape = posedShape(body);
  return shape.kind === 'circle'
    ? segmentVsCircle(ax, ay, bx, by, shape)
    : segmentVsBox(ax, ay, bx, by, shape);
}

/** First hit along the segment, across statics and dynamics. */
export function raycast(
  tiles: TileWorld,
  state: WorldState,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  filter?: QueryFilter,
  broadphase?: Broadphase
): WorldRayHit | undefined {
  let best: WorldRayHit | undefined;
  if (filter?.includeStatics !== false) {
    const staticHit = traceTiles(tiles, ax, ay, bx, by);
    if (staticHit) best = staticHit;
  }
  const bp = broadphase ?? buildBroadphase(state);
  const minX = Math.min(ax, bx);
  const maxX = Math.max(ax, bx);
  const minY = Math.min(ay, by);
  const maxY = Math.max(ay, by);
  for (const index of queryBroadphase(bp, minX, minY, maxX, maxY)) {
    const body = state.bodies[index];
    if (!passesFilter(body, filter)) continue;
    const hit = segmentVsBody(ax, ay, bx, by, body);
    if (hit && (!best || hit.t < best.t)) best = {...hit, bodyId: body.id};
  }
  return best;
}

/** All bodies overlapping the posed shape, id-sorted. Statics are not reported here. */
export function overlapShape(
  state: WorldState,
  shape: PosedShape,
  filter?: QueryFilter,
  broadphase?: Broadphase
): EngineBody[] {
  const bp = broadphase ?? buildBroadphase(state);
  const bounds = shapeAabb(shape);
  const hits: EngineBody[] = [];
  for (const index of queryBroadphase(bp, bounds.minX, bounds.minY, bounds.maxX, bounds.maxY)) {
    const body = state.bodies[index];
    if (!passesFilter(body, filter)) continue;
    if (shapesOverlap(shape, posedShape(body))) hits.push(body);
  }
  return hits;
}

export function overlapCircle(
  state: WorldState,
  x: number,
  y: number,
  radius: number,
  filter?: QueryFilter,
  broadphase?: Broadphase
): EngineBody[] {
  return overlapShape(state, {kind: 'circle', x, y, angle: 0, radius}, filter, broadphase);
}

/** Does the posed shape touch any blocked tile? (conservative: samples the shape's AABB corners + center vs exact per-tile overlap) */
export function shapeTouchesStatics(tiles: TileWorld, shape: PosedShape): boolean {
  const bounds = shapeAabb(shape);
  const startCol = Math.floor(bounds.minX / tiles.tileWidth);
  const endCol = Math.floor(bounds.maxX / tiles.tileWidth);
  const startRow = Math.floor(bounds.minY / tiles.tileHeight);
  const endRow = Math.floor(bounds.maxY / tiles.tileHeight);
  for (let row = startRow; row <= endRow; row++) {
    for (let col = startCol; col <= endCol; col++) {
      if (col >= 0 && row >= 0 && col < tiles.width && row < tiles.height && tiles.collisions[row * tiles.width + col] === 0) {
        continue;
      }
      const tileBox: PosedShape = {
        kind: 'box',
        x: (col + 0.5) * tiles.tileWidth,
        y: (row + 0.5) * tiles.tileHeight,
        angle: 0,
        halfLength: tiles.tileWidth / 2,
        halfWidth: tiles.tileHeight / 2,
      };
      if (shapesOverlap(shape, tileBox)) return true;
    }
  }
  return false;
}

export {isBlockedAt};
