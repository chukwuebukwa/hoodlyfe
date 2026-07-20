import {type VehicleKind} from '../../../shared/content/vehicle-catalog.ts';
import {vehicleWheelPositions} from '../../../shared/simulation/police-stinger-contact.ts';
import {vehicleSlipAngle} from '../../../shared/simulation/vehicle-step.ts';
import {VEHICLE_TYRE} from '../../../shared/simulation/vehicle-tyre-state.ts';

export interface VehicleSkidMarkInput {
  x: number;
  y: number;
  angle: number;
  linvelX: number;
  linvelY: number;
  kind: VehicleKind;
  destroyed?: boolean;
}

export interface VehicleSkidMarkPresentation {
  active: boolean;
  intensity: number;
  slipAngle: number;
  speed: number;
  rearLeft: {x: number; y: number};
  rearRight: {x: number; y: number};
}

const SKID_MINIMUM_SPEED = 90;
const SKID_MINIMUM_SLIP = 0.22;

export function vehicleSkidMarkPresentation(
  input: VehicleSkidMarkInput
): VehicleSkidMarkPresentation {
  const x = finite(input.x);
  const y = finite(input.y);
  const angle = finite(input.angle);
  const linvelX = finite(input.linvelX);
  const linvelY = finite(input.linvelY);
  const speed = Math.hypot(linvelX, linvelY);
  const slipAngle = Math.abs(vehicleSlipAngle({angle, linvelX, linvelY}));
  const wheels = vehicleWheelPositions({x, y, angle}, input.kind);
  const rearLeft = wheels.find((wheel) => wheel.tyre === VEHICLE_TYRE.rearLeft) ?? {x, y};
  const rearRight = wheels.find((wheel) => wheel.tyre === VEHICLE_TYRE.rearRight) ?? {x, y};
  const intensity = smoothstep(SKID_MINIMUM_SPEED, 260, speed) *
    smoothstep(SKID_MINIMUM_SLIP, 0.58, slipAngle);
  return Object.freeze({
    active: input.destroyed !== true && speed >= SKID_MINIMUM_SPEED &&
      slipAngle >= SKID_MINIMUM_SLIP,
    intensity,
    slipAngle,
    speed,
    rearLeft: Object.freeze({x: rearLeft.x, y: rearLeft.y}),
    rearRight: Object.freeze({x: rearRight.x, y: rearRight.y})
  });
}

function smoothstep(minimum: number, maximum: number, value: number): number {
  const factor = Math.max(0, Math.min(1, (value - minimum) / (maximum - minimum)));
  return factor * factor * (3 - 2 * factor);
}

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}
