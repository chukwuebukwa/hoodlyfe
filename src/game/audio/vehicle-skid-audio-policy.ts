import {vehicleSlipAngle} from '../../../shared/simulation/vehicle-step.ts';

export interface VehicleSkidAudioInput {
  angle: number;
  linvelX: number;
  linvelY: number;
  destroyed?: boolean;
}

export interface VehicleSkidAudioPresentation {
  active: boolean;
  intensity: number;
  slipAngle: number;
  speed: number;
}

const SKID_SOUND_MINIMUM_SPEED = 72;
const SKID_SOUND_MINIMUM_SLIP = 0.16;

export function vehicleSkidAudioPresentation(
  input: VehicleSkidAudioInput
): VehicleSkidAudioPresentation {
  const angle = finite(input.angle);
  const linvelX = finite(input.linvelX);
  const linvelY = finite(input.linvelY);
  const speed = Math.hypot(linvelX, linvelY);
  const slipAngle = Math.abs(vehicleSlipAngle({angle, linvelX, linvelY}));
  const speedWeight = smoothstep(SKID_SOUND_MINIMUM_SPEED, 260, speed);
  const slipWeight = smoothstep(SKID_SOUND_MINIMUM_SLIP, 0.58, slipAngle);
  return Object.freeze({
    active: input.destroyed !== true &&
      speed >= SKID_SOUND_MINIMUM_SPEED &&
      slipAngle >= SKID_SOUND_MINIMUM_SLIP,
    intensity: speedWeight * (0.35 + slipWeight * 0.65),
    slipAngle,
    speed
  });
}

function smoothstep(minimum: number, maximum: number, value: number): number {
  const factor = Math.max(0, Math.min(1, (value - minimum) / (maximum - minimum)));
  return factor * factor * (3 - 2 * factor);
}

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}
