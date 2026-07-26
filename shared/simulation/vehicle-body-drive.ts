// The single recipe both sides of the wire use to move a vehicle through the
// physics world: the handling kernel computes desired velocity and yaw, the body
// follows by velocity writeback, and the engine owns contact and pose integration.
// This remains the authoritative
// vehicle-motion boundary; presentation clients consume its replicated result.

import type {PhysicsBodyState, PhysicsWorld} from '../../engine/adapters/surface-physics.ts';
import {
  integrateVehicleMotion,
  type VehicleControlCommand,
  type VehicleMotionInput,
  type VehicleMotionState,
  type VehicleStepModifiers
} from './vehicle-step.ts';

export interface VehicleBodyCapture {
  pose: VehicleMotionState;
  collidedWithWorld: boolean;
  impactSpeed: number;
  impactVelocityX: number;
  impactVelocityY: number;
}

export interface VehicleBodyDrive {
  readonly desired: VehicleMotionState;
  readonly state: PhysicsBodyState;
}

export function planVehicleBodyDrive(
  pose: VehicleMotionInput,
  command: VehicleControlCommand,
  kind: string,
  deltaSeconds: number,
  modifiers: VehicleStepModifiers = {}
): VehicleBodyDrive {
  const desired = integrateVehicleMotion(pose, command, kind, deltaSeconds, modifiers);
  return {
    desired,
    state: {
      x: pose.x,
      y: pose.y,
      rotation: pose.angle,
      linvelX: desired.linvelX,
      linvelY: desired.linvelY,
      angvel: desired.angvel
    }
  };
}

export function driveVehicleBody(
  world: PhysicsWorld,
  key: string,
  kind: string,
  pose: VehicleMotionInput,
  command: VehicleControlCommand,
  deltaSeconds: number,
  modifiers: VehicleStepModifiers = {}
): VehicleMotionState {
  const {desired, state} = planVehicleBodyDrive(
    pose,
    command,
    kind,
    deltaSeconds,
    modifiers
  );
  if (world.has(key)) world.writeback(key, state);
  else world.registerVehicle(key, kind, state);
  return desired;
}

export function captureVehicleBody(
  world: PhysicsWorld,
  key: string,
  desired: VehicleMotionState
): VehicleBodyCapture | undefined {
  const state = world.capture(key);
  if (!state) return undefined;
  const angle = normalizeAngle(state.rotation);
  // The engine resolver reports true static impacts with approach speed, so
  // no attempted-vs-achieved displacement heuristic is needed anymore.
  const collidedWithWorld = world.hasStaticImpact(key, desired.linvelX, desired.linvelY);
  return {
    pose: {
      x: state.x,
      y: state.y,
      angle,
      speed: state.linvelX * Math.cos(angle) + state.linvelY * Math.sin(angle),
      linvelX: state.linvelX,
      linvelY: state.linvelY,
      angvel: state.angvel
    },
    collidedWithWorld,
    impactSpeed: collidedWithWorld ? Math.hypot(desired.linvelX, desired.linvelY) : 0,
    impactVelocityX: collidedWithWorld ? desired.linvelX : 0,
    impactVelocityY: collidedWithWorld ? desired.linvelY : 0
  };
}

function normalizeAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}
