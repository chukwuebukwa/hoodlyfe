export interface InterpolatedPosition {
  x: number;
  y: number;
  distance: number;
  snapped: boolean;
}

export function interpolatePosition(
  currentX: number,
  currentY: number,
  targetX: number,
  targetY: number,
  correction: number,
  snapDistance = Number.POSITIVE_INFINITY
): InterpolatedPosition {
  const distance = Math.hypot(targetX - currentX, targetY - currentY);
  if (distance > snapDistance) {
    return {x: targetX, y: targetY, distance, snapped: true};
  }
  const factor = clamp(correction, 0, 1);
  return {
    x: currentX + (targetX - currentX) * factor,
    y: currentY + (targetY - currentY) * factor,
    distance,
    snapped: false
  };
}

export function rotateTowards(current: number, target: number, maximumStep: number): number {
  const difference = normalizeAngle(target - current);
  const step = Math.max(0, maximumStep);
  if (Math.abs(difference) <= step) return normalizeAngle(target);
  return normalizeAngle(current + Math.sign(difference) * step);
}

function normalizeAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
