/** Closest-point and distance queries. */

import {emath} from '../core/math';
import type {Vec2} from '../core/vec';
import {axis, localOffsets, type PosedBox} from './overlap';

/** Closest point on segment AB to point P, returned with its parameter t ∈ [0,1]. */
export function closestPointOnSegment(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  px: number,
  py: number
): {x: number; y: number; t: number} {
  const abx = bx - ax;
  const aby = by - ay;
  const lengthSq = abx * abx + aby * aby;
  if (lengthSq < 1e-12) return {x: ax, y: ay, t: 0};
  let t = ((px - ax) * abx + (py - ay) * aby) / lengthSq;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return {x: ax + abx * t, y: ay + aby * t, t};
}

/** Closest point on (or inside) an oriented box to a world point. */
export function closestPointOnBox(box: PosedBox, px: number, py: number): Vec2 {
  const {forward, side} = localOffsets(box, px, py);
  const clampedForward = forward < -box.halfLength ? -box.halfLength : forward > box.halfLength ? box.halfLength : forward;
  const clampedSide = side < -box.halfWidth ? -box.halfWidth : side > box.halfWidth ? box.halfWidth : side;
  const f = axis(box.angle);
  return {
    x: box.x + f.x * clampedForward - f.y * clampedSide,
    y: box.y + f.y * clampedForward + f.x * clampedSide,
  };
}

export function distanceToBox(box: PosedBox, px: number, py: number): number {
  const closest = closestPointOnBox(box, px, py);
  return emath.hypot(px - closest.x, py - closest.y);
}
