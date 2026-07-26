/**
 * Time-of-impact sweeps. Rotation is frozen over the sweep interval (the same
 * assumption the traffic predictor makes today); the contact resolver's
 * substepping bounds the resulting error.
 *
 * sweptCircleTimeToContact is ported from the retired shared/physics/interaction-contact-geometry.ts;
 * sweptOrientedBoxTimeToContact from server/game/traffic/traffic-predictive-contact.ts.
 */

import {finite} from '../core/math';
import {axis, projectionRadius, type PosedBox, type PosedCircle} from './overlap';
import {segmentVsBox, type RayHit} from './raycast';
import {traceGrid} from './grid-trace';

export interface MotionCircle extends PosedCircle {
  velocityX: number;
  velocityY: number;
}

export interface MotionBox extends PosedBox {
  velocityX: number;
  velocityY: number;
}

const AXIS_EPSILON = 1e-9;

export function sweptCircleTimeToContact(
  left: MotionCircle,
  right: MotionCircle,
  horizonSeconds: number,
  margin = 0
): number | undefined {
  const horizon = Math.max(0, finite(horizonSeconds));
  const combinedRadius = Math.max(0, left.radius) + Math.max(0, right.radius) + Math.max(0, finite(margin));
  const relX = right.x - left.x;
  const relY = right.y - left.y;
  const relVx = right.velocityX - left.velocityX;
  const relVy = right.velocityY - left.velocityY;
  const c = relX * relX + relY * relY - combinedRadius * combinedRadius;
  if (c <= 0) return 0;
  const a = relVx * relVx + relVy * relVy;
  if (a <= Number.EPSILON) return undefined;
  const b = 2 * (relX * relVx + relY * relVy);
  if (b >= 0) return undefined;
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return undefined;
  const contactAt = (-b - Math.sqrt(discriminant)) / (2 * a);
  return contactAt >= 0 && contactAt <= horizon ? contactAt : undefined;
}

export function sweptOrientedBoxTimeToContact(
  left: MotionBox,
  right: MotionBox,
  horizonSeconds: number,
  margin = 0
): number | undefined {
  if (horizonSeconds < 0) return undefined;
  const leftForward = axis(left.angle);
  const leftSide = {x: -leftForward.y, y: leftForward.x};
  const rightForward = axis(right.angle);
  const rightSide = {x: -rightForward.y, y: rightForward.x};
  const relPos = {x: right.x - left.x, y: right.y - left.y};
  const relVel = {x: right.velocityX - left.velocityX, y: right.velocityY - left.velocityY};
  let entrySeconds = 0;
  let exitSeconds = horizonSeconds;

  for (const testAxis of [leftForward, leftSide, rightForward, rightSide]) {
    const distance = relPos.x * testAxis.x + relPos.y * testAxis.y;
    const velocity = relVel.x * testAxis.x + relVel.y * testAxis.y;
    const reach =
      projectionRadius(left, leftForward, leftSide, testAxis) +
      projectionRadius(right, rightForward, rightSide, testAxis) +
      Math.max(0, margin);
    if (Math.abs(velocity) <= AXIS_EPSILON) {
      if (Math.abs(distance) > reach) return undefined;
      continue;
    }
    const first = (-reach - distance) / velocity;
    const second = (reach - distance) / velocity;
    entrySeconds = Math.max(entrySeconds, Math.min(first, second));
    exitSeconds = Math.min(exitSeconds, Math.max(first, second));
    if (entrySeconds > exitSeconds) return undefined;
  }

  return entrySeconds <= horizonSeconds && exitSeconds >= 0 ? Math.max(0, entrySeconds) : undefined;
}

/**
 * Swept circle vs a moving oriented box: Minkowski trick — sweep the circle's
 * center (relative velocity) against the box inflated by the radius. The
 * inflated box's rounded corners are approximated by the sharp-corner box,
 * which slightly over-reports corner contacts; acceptable for TOI ordering
 * since the manifold pass computes exact separation afterward.
 */
export function sweptCircleBoxTimeToContact(
  circle: MotionCircle,
  box: MotionBox,
  horizonSeconds: number,
  margin = 0
): number | undefined {
  if (horizonSeconds < 0) return undefined;
  const relVx = circle.velocityX - box.velocityX;
  const relVy = circle.velocityY - box.velocityY;
  const inflated: PosedBox = {
    kind: 'box',
    x: box.x,
    y: box.y,
    angle: box.angle,
    halfLength: box.halfLength + circle.radius + Math.max(0, margin),
    halfWidth: box.halfWidth + circle.radius + Math.max(0, margin),
  };
  const hit = segmentVsBox(
    circle.x,
    circle.y,
    circle.x + relVx * horizonSeconds,
    circle.y + relVy * horizonSeconds,
    inflated
  );
  return hit ? hit.t * horizonSeconds : undefined;
}

/**
 * Sweep a circle through the tile grid: trace the center segment against the
 * grid inflated by the radius (approximated by tracing the center plus edge
 * probes offset by the radius perpendicular to travel). Exact-enough for TOI
 * ordering; the character solver's slide handles the contact itself.
 */
export function sweptCircleVsGrid(
  x: number,
  y: number,
  velocityX: number,
  velocityY: number,
  radius: number,
  horizonSeconds: number,
  isBlocked: (col: number, row: number) => boolean,
  tileWidth: number,
  tileHeight: number
): RayHit | undefined {
  const dx = velocityX * horizonSeconds;
  const dy = velocityY * horizonSeconds;
  const speed = Math.sqrt(dx * dx + dy * dy);
  if (speed < 1e-12) return undefined;
  const px = (-dy / speed) * radius;
  const py = (dx / speed) * radius;
  // Center ray plus the two tangent edge rays; earliest hit wins.
  let best: RayHit | undefined;
  for (const [ox, oy] of [
    [0, 0],
    [px, py],
    [-px, -py],
  ] as const) {
    const hit = traceGrid(x + ox, y + oy, x + ox + dx, y + oy + dy, isBlocked, tileWidth, tileHeight);
    if (hit && (!best || hit.t < best.t)) best = hit;
  }
  return best;
}
