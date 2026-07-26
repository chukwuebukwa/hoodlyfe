/**
 * Exact segment-vs-shape raycasts. All functions return the first hit along
 * the segment (t ∈ [0,1], world-space point, unit outward normal) or
 * undefined. Segments starting inside a shape report t=0 with the normal
 * pointing back along the ray.
 */

import {emath} from '../core/math';
import type {PosedBox, PosedCircle} from './overlap';

export interface RayHit {
  t: number;
  x: number;
  y: number;
  normalX: number;
  normalY: number;
}

export function segmentVsCircle(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  circle: PosedCircle
): RayHit | undefined {
  const dx = bx - ax;
  const dy = by - ay;
  const fx = ax - circle.x;
  const fy = ay - circle.y;
  const r = circle.radius;
  if (fx * fx + fy * fy <= r * r) {
    const inv = emath.hypot(dx, dy);
    const nx = inv > 1e-12 ? -dx / inv : 1;
    const ny = inv > 1e-12 ? -dy / inv : 0;
    return {t: 0, x: ax, y: ay, normalX: nx, normalY: ny};
  }
  const a = dx * dx + dy * dy;
  if (a < 1e-12) return undefined;
  const b = 2 * (fx * dx + fy * dy);
  const c = fx * fx + fy * fy - r * r;
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return undefined;
  const t = (-b - Math.sqrt(discriminant)) / (2 * a);
  if (t < 0 || t > 1) return undefined;
  const hx = ax + dx * t;
  const hy = ay + dy * t;
  const len = emath.hypot(hx - circle.x, hy - circle.y);
  return {
    t,
    x: hx,
    y: hy,
    normalX: len > 1e-12 ? (hx - circle.x) / len : 1,
    normalY: len > 1e-12 ? (hy - circle.y) / len : 0,
  };
}

/** Slab test in the box's local frame. */
export function segmentVsBox(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  box: PosedBox
): RayHit | undefined {
  const c = emath.cos(box.angle);
  const s = emath.sin(box.angle);
  // Transform segment into box-local coordinates (forward = local x, side = local y).
  const relAx = ax - box.x;
  const relAy = ay - box.y;
  const localAx = relAx * c + relAy * s;
  const localAy = -relAx * s + relAy * c;
  const worldDx = bx - ax;
  const worldDy = by - ay;
  const localDx = worldDx * c + worldDy * s;
  const localDy = -worldDx * s + worldDy * c;

  let tEntry = 0;
  let tExit = 1;
  let entryAxis: 'x' | 'y' | null = null;
  let entrySign = 1;

  for (const [origin, delta, extent, axisName] of [
    [localAx, localDx, box.halfLength, 'x'],
    [localAy, localDy, box.halfWidth, 'y'],
  ] as const) {
    if (Math.abs(delta) < 1e-12) {
      if (Math.abs(origin) > extent) return undefined;
      continue;
    }
    const inv = 1 / delta;
    let near = (-extent - origin) * inv;
    let far = (extent - origin) * inv;
    let sign = -1;
    if (near > far) {
      const swap = near;
      near = far;
      far = swap;
      sign = 1;
    }
    if (near > tEntry) {
      tEntry = near;
      entryAxis = axisName;
      entrySign = sign;
    }
    tExit = Math.min(tExit, far);
    if (tEntry > tExit) return undefined;
  }

  if (entryAxis === null) {
    // Segment starts inside the box.
    const inv = emath.hypot(worldDx, worldDy);
    return {
      t: 0,
      x: ax,
      y: ay,
      normalX: inv > 1e-12 ? -worldDx / inv : 1,
      normalY: inv > 1e-12 ? -worldDy / inv : 0,
    };
  }

  // Local outward normal on the entry face, rotated back to world space.
  const localNx = entryAxis === 'x' ? entrySign : 0;
  const localNy = entryAxis === 'y' ? entrySign : 0;
  return {
    t: tEntry,
    x: ax + worldDx * tEntry,
    y: ay + worldDy * tEntry,
    normalX: localNx * c - localNy * s,
    normalY: localNx * s + localNy * c,
  };
}

export function segmentVsAabb(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number
): RayHit | undefined {
  return segmentVsBox(ax, ay, bx, by, {
    kind: 'box',
    x: (minX + maxX) / 2,
    y: (minY + maxY) / 2,
    angle: 0,
    halfLength: (maxX - minX) / 2,
    halfWidth: (maxY - minY) / 2,
  });
}
