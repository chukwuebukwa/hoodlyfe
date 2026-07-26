/**
 * Deterministic scalar math for the engine.
 *
 * All transcendental calls in engine code MUST go through `emath` rather than
 * `Math` directly. `+ - * / sqrt` are IEEE-754-exact across JS engines;
 * sin/cos/atan2/exp are not spec-pinned. NOTE: aliasing them here does NOT
 * make results cross-engine deterministic — it only centralizes the
 * nondeterminism into one swap point, so a software implementation could be
 * substituted later. The engine's guarantee remains "bit-identical for same
 * build + same JS engine" (the journal contract).
 */

export const emath = {
  sin: Math.sin,
  cos: Math.cos,
  atan2: Math.atan2,
  exp: Math.exp,
  sqrt: Math.sqrt,
  // Math.hypot is slow and not bit-portable; this form is exact IEEE arithmetic.
  hypot(x: number, y: number): number {
    return Math.sqrt(x * x + y * y);
  },
};

export function finite(value: number, fallback = 0): number {
  return Number.isFinite(value) ? value : fallback;
}

export function finiteClamp(value: number, min: number, max: number, fallback = 0): number {
  const safe = Number.isFinite(value) ? value : fallback;
  return safe < min ? min : safe > max ? max : safe;
}

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/** Same normalization used by shared/simulation/vehicle-step.ts. */
export function normalizeAngle(angle: number): number {
  return emath.atan2(emath.sin(angle), emath.cos(angle));
}

export function shortestAngle(from: number, to: number): number {
  return normalizeAngle(to - from);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Move `value` toward `target` by at most `maxDelta`. */
export function approach(value: number, target: number, maxDelta: number): number {
  const delta = target - value;
  if (delta > maxDelta) return value + maxDelta;
  if (delta < -maxDelta) return value - maxDelta;
  return target;
}

export const EPSILON = 1e-9;
export const CONTACT_SLOP = 0.5;
