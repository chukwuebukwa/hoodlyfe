/**
 * Analytical vehicle drive kernel — the arcade handling model. Ported verbatim
 * from shared/simulation/vehicle-step.ts (integrateVehicleMotion); the parity
 * test in test/engine/ asserts bit-identical output against the original.
 * The kernel computes *intent* (desired velocity/pose); collision is the
 * contact resolver's job.
 */

import {vehicleDefinition} from '../../shared/content/vehicle-catalog.ts';

export const VEHICLE_MAX_STEP_SECONDS = 0.05;

export interface VehicleHandling {
  forwardAcceleration: number;
  reverseAcceleration: number;
  brakeDeceleration: number;
  coastDeceleration: number;
  maximumForwardSpeed: number;
  maximumReverseSpeed: number;
  steeringRate: number;
  steeringGripSpeed: number;
  steeringGripFloor: number;
  yawResponse: number;
  lateralGrip: number;
  handbrakeLateralGrip: number;
  handbrakeTurnMultiplier: number;
  powerOversteer: number;
}

export interface VehicleKernelPose {
  x: number;
  y: number;
  angle: number;
  speed: number;
  linvelX?: number;
  linvelY?: number;
  angvel?: number;
}

export interface VehicleKernelState {
  x: number;
  y: number;
  angle: number;
  speed: number;
  linvelX: number;
  linvelY: number;
  angvel: number;
}

export interface VehicleKernelCommand {
  steering: number;
  throttle: number;
  handbrake?: boolean;
}

export interface VehicleKernelModifiers {
  maximumSpeedMultiplier?: number;
  accelerationMultiplier?: number;
  brakeDecelerationMultiplier?: number;
  coastDecelerationMultiplier?: number;
  steeringRateMultiplier?: number;
  steeringBias?: number;
}

export function vehicleHandlingForKind(kind: string): VehicleHandling {
  return vehicleDefinition(kind).handling;
}

/**
 * THE kernel→resolver hand-off. The resolver is the sole pose integrator:
 * this runs the kernel from the body's current state and writes back ONLY
 * velocities (linvel, angvel). The kernel's own integrated x/y/angle are
 * discarded — resolveDynamics advances the pose from these velocities, which
 * reproduces the kernel's integration exactly (x += v·dt, angle += ω·dt)
 * while letting contacts clip the motion. Copying the kernel's pose AND
 * velocities into a body double-integrates; never do that.
 */
export function driveVehicleState(
  state: {x: number; y: number; angle: number; linvelX: number; linvelY: number; angvel: number},
  command: VehicleKernelCommand,
  handling: VehicleHandling,
  deltaSeconds: number,
  modifiers: VehicleKernelModifiers = {}
): void {
  const next = integrateVehicleKernel(
    {
      x: state.x,
      y: state.y,
      angle: state.angle,
      speed: 0,
      linvelX: state.linvelX,
      linvelY: state.linvelY,
      angvel: state.angvel,
    },
    command,
    handling,
    deltaSeconds,
    modifiers
  );
  state.linvelX = next.linvelX;
  state.linvelY = next.linvelY;
  state.angvel = next.angvel;
}

export function integrateVehicleKernel(
  pose: VehicleKernelPose,
  command: VehicleKernelCommand,
  handling: VehicleHandling,
  deltaSeconds: number,
  modifiers: VehicleKernelModifiers = {}
): VehicleKernelState {
  const delta = finiteClamp(deltaSeconds, 0, VEHICLE_MAX_STEP_SECONDS);
  const throttle = finiteClamp(command.throttle, -1, 1);
  const steering = finiteClamp(
    command.steering + finiteClamp(modifiers.steeringBias ?? 0, -0.25, 0.25),
    -1,
    1
  );
  const handbrake = command.handbrake === true;
  const speedMultiplier = finiteClamp(modifiers.maximumSpeedMultiplier ?? 1, 0, 1);
  const accelerationMultiplier = finiteClamp(modifiers.accelerationMultiplier ?? 1, 0.1, 2);
  const brakeMultiplier = finiteClamp(modifiers.brakeDecelerationMultiplier ?? 1, 0.1, 2);
  const coastMultiplier = finiteClamp(modifiers.coastDecelerationMultiplier ?? 1, 0.1, 2);
  const steeringRateMultiplier = finiteClamp(modifiers.steeringRateMultiplier ?? 1, 0.1, 2);
  let angle = normalizeAngle(finite(pose.angle));
  let velocityX = finite(pose.linvelX ?? 0);
  let velocityY = finite(pose.linvelY ?? 0);
  if (Math.hypot(velocityX, velocityY) < 0.001 && Math.abs(finite(pose.speed)) >= 0.001) {
    velocityX = Math.cos(angle) * finite(pose.speed);
    velocityY = Math.sin(angle) * finite(pose.speed);
  }

  let forwardX = Math.cos(angle);
  let forwardY = Math.sin(angle);
  let forwardSpeed = velocityX * forwardX + velocityY * forwardY;
  if (throttle !== 0) {
    const changingDirection = Math.abs(forwardSpeed) > 1 && Math.sign(forwardSpeed) !== Math.sign(throttle);
    if (changingDirection) {
      [velocityX, velocityY] = slowVelocity(
        velocityX,
        velocityY,
        handling.brakeDeceleration * brakeMultiplier * delta
      );
    } else {
      const acceleration = throttle > 0
        ? handling.forwardAcceleration
        : handling.reverseAcceleration;
      velocityX += forwardX * throttle * acceleration * accelerationMultiplier * delta;
      velocityY += forwardY * throttle * acceleration * accelerationMultiplier * delta;
    }
  } else {
    [velocityX, velocityY] = slowVelocity(
      velocityX,
      velocityY,
      handling.coastDeceleration * coastMultiplier * delta
    );
  }
  if (handbrake) {
    [velocityX, velocityY] = slowVelocity(
      velocityX,
      velocityY,
      handling.brakeDeceleration * brakeMultiplier * 0.18 * delta
    );
  }

  forwardSpeed = velocityX * forwardX + velocityY * forwardY;
  const minimumSpeed = -handling.maximumReverseSpeed * speedMultiplier;
  const maximumSpeed = handling.maximumForwardSpeed * speedMultiplier;
  if (forwardSpeed < minimumSpeed) {
    const excess = forwardSpeed - minimumSpeed;
    velocityX -= forwardX * excess;
    velocityY -= forwardY * excess;
  } else if (forwardSpeed > maximumSpeed) {
    const excess = forwardSpeed - maximumSpeed;
    velocityX -= forwardX * excess;
    velocityY -= forwardY * excess;
  }

  forwardSpeed = velocityX * forwardX + velocityY * forwardY;
  const speedMagnitude = Math.hypot(velocityX, velocityY);
  const grip = finiteClamp(
    Math.abs(forwardSpeed) / handling.steeringGripSpeed,
    handling.steeringGripFloor,
    1
  );
  const direction = forwardSpeed >= 0 ? 1 : -1;
  let targetAngularVelocity = Math.abs(forwardSpeed) > 4
    ? steering * handling.steeringRate * steeringRateMultiplier * grip * direction
    : 0;
  if (handbrake && speedMagnitude > 45) {
    targetAngularVelocity *= handling.handbrakeTurnMultiplier;
  }
  const yawResponse = handling.yawResponse * (handbrake ? 0.48 : 1);
  let angularVelocity = finite(pose.angvel ?? 0);
  angularVelocity += (targetAngularVelocity - angularVelocity) * (1 - Math.exp(-yawResponse * delta));
  const maximumYaw = handling.steeringRate * steeringRateMultiplier * 1.8;
  angularVelocity = finiteClamp(angularVelocity, -maximumYaw, maximumYaw);
  angle = normalizeAngle(angle + angularVelocity * delta);

  forwardX = Math.cos(angle);
  forwardY = Math.sin(angle);
  const sideX = -forwardY;
  const sideY = forwardX;
  forwardSpeed = velocityX * forwardX + velocityY * forwardY;
  const lateralSpeed = velocityX * sideX + velocityY * sideY;
  const speedRatio = finiteClamp(
    Math.abs(forwardSpeed) / Math.max(1, handling.steeringGripSpeed),
    0,
    1
  );
  const slipAngle = Math.abs(vehicleKernelSlipAngle({angle, linvelX: velocityX, linvelY: velocityY}));
  const retainedDrift = handbrake ? 0 : smoothstep(0.18, 0.5, slipAngle);
  const powerSlip = Math.max(0, throttle) * Math.abs(steering) * speedRatio * handling.powerOversteer;
  const tyreCondition = finiteClamp(steeringRateMultiplier, 0.45, 1.15);
  const lateralGrip = (handbrake
    ? handling.handbrakeLateralGrip
    : handling.lateralGrip * (1 - powerSlip) * (1 - retainedDrift * 0.82)) * tyreCondition;
  const lateralCorrection = lateralSpeed * (1 - Math.exp(-lateralGrip * delta));
  velocityX -= sideX * lateralCorrection;
  velocityY -= sideY * lateralCorrection;

  const totalSpeedLimit = Math.max(handling.maximumForwardSpeed, handling.maximumReverseSpeed) *
    Math.max(0.1, speedMultiplier) * 1.12;
  const totalSpeed = Math.hypot(velocityX, velocityY);
  if (totalSpeed > totalSpeedLimit) {
    const scale = totalSpeedLimit / totalSpeed;
    velocityX *= scale;
    velocityY *= scale;
  }
  const speed = velocityX * forwardX + velocityY * forwardY;
  const x = finite(pose.x);
  const y = finite(pose.y);
  return {
    x: x + velocityX * delta,
    y: y + velocityY * delta,
    angle,
    speed: finite(speed),
    linvelX: finite(velocityX),
    linvelY: finite(velocityY),
    angvel: finite(angularVelocity)
  };
}

export function vehicleKernelSlipAngle(
  motion: {angle: number; linvelX: number; linvelY: number}
): number {
  const angle = finite(motion.angle);
  const velocityX = finite(motion.linvelX);
  const velocityY = finite(motion.linvelY);
  const forwardSpeed = velocityX * Math.cos(angle) + velocityY * Math.sin(angle);
  const lateralSpeed = velocityX * -Math.sin(angle) + velocityY * Math.cos(angle);
  return Math.atan2(lateralSpeed, Math.max(1, Math.abs(forwardSpeed)));
}

function slowVelocity(x: number, y: number, amount: number): [number, number] {
  const speed = Math.hypot(x, y);
  if (speed <= amount || speed === 0) return [0, 0];
  const scale = (speed - amount) / speed;
  return [x * scale, y * scale];
}

function smoothstep(minimum: number, maximum: number, value: number): number {
  const factor = finiteClamp((value - minimum) / Math.max(Number.EPSILON, maximum - minimum), 0, 1);
  return factor * factor * (3 - 2 * factor);
}

function normalizeAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function finiteClamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, finite(value)));
}
