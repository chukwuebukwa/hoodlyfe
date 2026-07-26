/**
 * Boolean overlap tests between engine shapes at given poses.
 * Adapted from shared/physics/interaction-contact-geometry.ts (SAT for OBBs,
 * clamped closest point for circle-vs-box).
 */

import {emath} from '../core/math';
import type {Pose, ShapeBox, ShapeCircle} from '../core/types';

export type PosedCircle = Pose & ShapeCircle;
export type PosedBox = Pose & ShapeBox;
export type PosedShape = PosedCircle | PosedBox;

export function circlesOverlap(a: PosedCircle, b: PosedCircle, slop = 0): boolean {
  const radius = a.radius + b.radius + Math.max(0, slop);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return dx * dx + dy * dy <= radius * radius;
}

export function circleBoxOverlap(circle: PosedCircle, box: PosedBox, slop = 0): boolean {
  const {forward, side} = localOffsets(box, circle.x, circle.y);
  const nearestForward = clampScalar(forward, -box.halfLength, box.halfLength);
  const nearestSide = clampScalar(side, -box.halfWidth, box.halfWidth);
  const offsetForward = forward - nearestForward;
  const offsetSide = side - nearestSide;
  const radius = circle.radius + Math.max(0, slop);
  return offsetForward * offsetForward + offsetSide * offsetSide <= radius * radius;
}

export function boxesOverlap(a: PosedBox, b: PosedBox, slop = 0): boolean {
  const safeSlop = Math.max(0, slop);
  const aForward = axis(a.angle);
  const aSide = {x: -aForward.y, y: aForward.x};
  const bForward = axis(b.angle);
  const bSide = {x: -bForward.y, y: bForward.x};
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  for (const candidate of [aForward, aSide, bForward, bSide]) {
    const centerDistance = Math.abs(dx * candidate.x + dy * candidate.y);
    const reach =
      projectionRadius(a, aForward, aSide, candidate) +
      projectionRadius(b, bForward, bSide, candidate) +
      safeSlop;
    if (centerDistance > reach) return false;
  }
  return true;
}

export function shapesOverlap(a: PosedShape, b: PosedShape, slop = 0): boolean {
  if (a.kind === 'circle' && b.kind === 'circle') return circlesOverlap(a, b, slop);
  if (a.kind === 'box' && b.kind === 'box') return boxesOverlap(a, b, slop);
  if (a.kind === 'circle' && b.kind === 'box') return circleBoxOverlap(a, b, slop);
  if (a.kind === 'box' && b.kind === 'circle') return circleBoxOverlap(b, a, slop);
  return false;
}

export function pointInBox(box: PosedBox, x: number, y: number): boolean {
  const {forward, side} = localOffsets(box, x, y);
  return Math.abs(forward) <= box.halfLength && Math.abs(side) <= box.halfWidth;
}

export function pointInCircle(circle: PosedCircle, x: number, y: number): boolean {
  const dx = x - circle.x;
  const dy = y - circle.y;
  return dx * dx + dy * dy <= circle.radius * circle.radius;
}

/** Axis-aligned bounds of a posed shape, inflated by `margin`. */
export function shapeAabb(
  shape: PosedShape,
  margin = 0
): {minX: number; minY: number; maxX: number; maxY: number} {
  if (shape.kind === 'circle') {
    const r = shape.radius + margin;
    return {minX: shape.x - r, minY: shape.y - r, maxX: shape.x + r, maxY: shape.y + r};
  }
  const c = Math.abs(emath.cos(shape.angle));
  const s = Math.abs(emath.sin(shape.angle));
  const extentX = shape.halfLength * c + shape.halfWidth * s + margin;
  const extentY = shape.halfLength * s + shape.halfWidth * c + margin;
  return {minX: shape.x - extentX, minY: shape.y - extentY, maxX: shape.x + extentX, maxY: shape.y + extentY};
}

export interface Axis {
  x: number;
  y: number;
}

export function axis(angle: number): Axis {
  return {x: emath.cos(angle), y: emath.sin(angle)};
}

export function projectionRadius(box: ShapeBox, forward: Axis, side: Axis, candidate: Axis): number {
  return (
    box.halfLength * Math.abs(forward.x * candidate.x + forward.y * candidate.y) +
    box.halfWidth * Math.abs(side.x * candidate.x + side.y * candidate.y)
  );
}

/** World point expressed in a box's local (forward, side) frame. */
export function localOffsets(box: PosedBox, x: number, y: number): {forward: number; side: number} {
  const c = emath.cos(box.angle);
  const s = emath.sin(box.angle);
  const dx = x - box.x;
  const dy = y - box.y;
  return {forward: dx * c + dy * s, side: -dx * s + dy * c};
}

function clampScalar(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}
