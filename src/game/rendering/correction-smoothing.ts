export const ON_FOOT_CORRECTION_DECAY_RATE = 14;
export const VEHICLE_CORRECTION_DECAY_RATE = 12;
export const MAX_CORRECTION_DECAY_SECONDS = 0.05;

export interface PositionCorrectionOffset {
  readonly x: number;
  readonly y: number;
}

export function positionCorrectionOffset(
  beforeX: number,
  beforeY: number,
  simulationX: number,
  simulationY: number,
  hardCorrection: boolean
): PositionCorrectionOffset {
  return hardCorrection
    ? Object.freeze({x: 0, y: 0})
    : Object.freeze({
      x: finite(beforeX) - finite(simulationX),
      y: finite(beforeY) - finite(simulationY)
    });
}

export function angleCorrectionOffset(
  beforeAngle: number,
  simulationAngle: number,
  hardCorrection: boolean
): number {
  return hardCorrection ? 0 : normalizeAngle(finite(beforeAngle) - finite(simulationAngle));
}

export function decayCorrectionOffset(
  value: number,
  deltaSeconds: number,
  rate: number
): number {
  const delta = Math.min(Math.max(finite(deltaSeconds), 0), MAX_CORRECTION_DECAY_SECONDS);
  const safeRate = Math.max(0, finite(rate));
  const decayed = finite(value) * Math.exp(-safeRate * delta);
  return Math.abs(decayed) < 0.0001 ? 0 : decayed;
}

function normalizeAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}
