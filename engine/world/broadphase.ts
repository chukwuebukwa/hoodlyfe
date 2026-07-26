/**
 * Uniform-grid broad-phase over dynamic bodies. A derived cache: rebuilt from
 * the id-sorted body array, never serialized. Numeric cell keys; results are
 * always returned in body-array (id-sorted) order, which keeps every consumer
 * deterministic.
 */

import type {EngineBody, WorldState} from '../core/types';
import {shapeAabb} from '../geometry/overlap';
import {posedShape} from './world-state';

export const BROADPHASE_CELL_SIZE = 256;

// Cell key packing: shift coords so negatives stay positive, then interleave.
const KEY_BIAS = 1 << 15;
const KEY_STRIDE = 1 << 16;

function cellKey(cellX: number, cellY: number): number {
  // Clamp instead of silently colliding beyond ±32767 cells (±8.4M px):
  // far-out bodies degrade to shared edge cells rather than corrupting keys.
  const cx = cellX < -KEY_BIAS ? -KEY_BIAS : cellX >= KEY_BIAS ? KEY_BIAS - 1 : cellX;
  const cy = cellY < -KEY_BIAS ? -KEY_BIAS : cellY >= KEY_BIAS ? KEY_BIAS - 1 : cellY;
  return (cx + KEY_BIAS) * KEY_STRIDE + (cy + KEY_BIAS);
}

export interface Broadphase {
  readonly cellSize: number;
  /** cellKey -> indices into the body array, ascending. */
  readonly buckets: Map<number, number[]>;
  /** Per-body covered-cell AABB in cell coords: [minCX, minCY, maxCX, maxCY]. */
  readonly coverage: Array<[number, number, number, number]>;
}

export function buildBroadphase(state: WorldState, cellSize = BROADPHASE_CELL_SIZE, margin = 0): Broadphase {
  const buckets = new Map<number, number[]>();
  const coverage: Array<[number, number, number, number]> = [];
  for (let index = 0; index < state.bodies.length; index++) {
    const bounds = shapeAabb(posedShape(state.bodies[index]), margin);
    const minCX = Math.floor(bounds.minX / cellSize);
    const minCY = Math.floor(bounds.minY / cellSize);
    const maxCX = Math.floor(bounds.maxX / cellSize);
    const maxCY = Math.floor(bounds.maxY / cellSize);
    coverage.push([minCX, minCY, maxCX, maxCY]);
    for (let cx = minCX; cx <= maxCX; cx++) {
      for (let cy = minCY; cy <= maxCY; cy++) {
        const key = cellKey(cx, cy);
        const bucket = buckets.get(key);
        if (bucket) bucket.push(index);
        else buckets.set(key, [index]);
      }
    }
  }
  return {cellSize, buckets, coverage};
}

/** Body indices whose coverage intersects the AABB, ascending and de-duplicated. */
export function queryBroadphase(
  broadphase: Broadphase,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number
): number[] {
  const minCX = Math.floor(minX / broadphase.cellSize);
  const minCY = Math.floor(minY / broadphase.cellSize);
  const maxCX = Math.floor(maxX / broadphase.cellSize);
  const maxCY = Math.floor(maxY / broadphase.cellSize);
  const seen = new Set<number>();
  for (let cx = minCX; cx <= maxCX; cx++) {
    for (let cy = minCY; cy <= maxCY; cy++) {
      const bucket = broadphase.buckets.get(cellKey(cx, cy));
      if (!bucket) continue;
      for (const index of bucket) seen.add(index);
    }
  }
  return [...seen].sort((a, b) => a - b);
}

/**
 * Candidate collision pairs [i, j] with i < j, each pair once, ordered by
 * (i, j) — the canonical processing order for the contact resolver.
 */
export function candidatePairs(state: WorldState, broadphase: Broadphase): Array<[number, number]> {
  const pairs: Array<[number, number]> = [];
  const emitted = new Set<number>();
  for (const bucket of broadphase.buckets.values()) {
    for (let a = 0; a < bucket.length; a++) {
      for (let b = a + 1; b < bucket.length; b++) {
        const i = bucket[a];
        const j = bucket[b];
        const bodyA = state.bodies[i];
        const bodyB = state.bodies[j];
        // Rapier group semantics: BOTH directions must permit the pair.
        if ((bodyA.mask & bodyB.layer) === 0 || (bodyB.mask & bodyA.layer) === 0) continue;
        const pairKey = i * state.bodies.length + j;
        if (emitted.has(pairKey)) continue;
        emitted.add(pairKey);
        pairs.push([i, j]);
      }
    }
  }
  pairs.sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));
  return pairs;
}
