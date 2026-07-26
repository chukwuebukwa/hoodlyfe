/**
 * Plain {x, y} vector helpers. No classes, no hidden state: every function
 * takes and returns scalars or plain objects so results stay hashable and
 * structured-clone friendly.
 */

export interface Vec2 {
  x: number;
  y: number;
}

export function dot(ax: number, ay: number, bx: number, by: number): number {
  return ax * bx + ay * by;
}

/** 2D cross product (z of the 3D cross). */
export function cross(ax: number, ay: number, bx: number, by: number): number {
  return ax * by - ay * bx;
}

export function lengthSq(x: number, y: number): number {
  return x * x + y * y;
}

export function length(x: number, y: number): number {
  return Math.sqrt(x * x + y * y);
}

export function distanceSq(ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  return dx * dx + dy * dy;
}

/** Left perpendicular in y-down coordinates: rotates +90° clockwise on screen. */
export function perp(v: Vec2): Vec2 {
  return {x: -v.y, y: v.x};
}

export function normalize(x: number, y: number): Vec2 {
  const len = Math.sqrt(x * x + y * y);
  if (len < 1e-12) return {x: 0, y: 0};
  return {x: x / len, y: y / len};
}
