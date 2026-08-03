const MAX_AIRBORNE_STEP_SECONDS = 0.05;

export const AIRBORNE_GRAVITY = 640;

export interface AirborneMotionState {
  readonly x: number;
  readonly y: number;
  readonly angle: number;
  readonly elevation: number;
  readonly verticalVelocity: number;
  readonly velocityX: number;
  readonly velocityY: number;
  readonly angularVelocity?: number;
}

export interface AirborneMotionStep extends AirborneMotionState {
  readonly previousElevation: number;
}

export function stepAirborneMotion(
  state: AirborneMotionState,
  deltaSeconds: number,
  gravity = AIRBORNE_GRAVITY
): AirborneMotionStep {
  const delta = Math.max(0, Math.min(MAX_AIRBORNE_STEP_SECONDS, deltaSeconds));
  const verticalVelocity = state.verticalVelocity - gravity * delta;
  return Object.freeze({
    x: state.x + state.velocityX * delta,
    y: state.y + state.velocityY * delta,
    angle: normalizeAngle(state.angle + (state.angularVelocity ?? 0) * delta),
    elevation: state.elevation +
      state.verticalVelocity * delta -
      gravity * delta * delta * 0.5,
    verticalVelocity,
    velocityX: state.velocityX,
    velocityY: state.velocityY,
    angularVelocity: state.angularVelocity ?? 0,
    previousElevation: state.elevation
  });
}

function normalizeAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}
