// The single recipe both sides of the wire use to move a vehicle through the
// physics world: the handling kernel computes desired motion, the body follows by
// velocity writeback with kernel-authored heading (zero spin - the engine's angvel
// integration drifts microradians per tick, which compounds through sustained
// turns), and the engine owns translation contact. Server simulation and client
// prediction must stay bit-compatible, so neither may diverge from this module.

import type {PhysicsBodyState, PhysicsWorld} from '../physics/physics-world.ts';
import {
  integrateVehiclePose,
  type VehicleControlCommand,
  type VehicleStepModifiers,
  type VehicleWorldPose
} from './vehicle-step.ts';

// Attempted-vs-achieved gaps under this are unobstructed motion; above it, a world
// contact. Well above f32 noise, well below one tick of driving displacement.
const WORLD_CONTACT_SHORTFALL = 1;

export interface VehicleBodyCapture {
  pose: VehicleWorldPose;
  collidedWithWorld: boolean;
  impactSpeed: number;
}

export interface VehicleBodyDrive {
  readonly desired: VehicleWorldPose;
  readonly state: PhysicsBodyState;
}

export function planVehicleBodyDrive(
  pose: VehicleWorldPose,
  command: VehicleControlCommand,
  kind: string,
  deltaSeconds: number,
  modifiers: VehicleStepModifiers = {}
): VehicleBodyDrive {
  const desired = integrateVehiclePose(pose, command, kind, deltaSeconds, modifiers);
  return {
    desired,
    state: {
      x: pose.x,
      y: pose.y,
      rotation: desired.angle,
      linvelX: (desired.x - pose.x) / deltaSeconds,
      linvelY: (desired.y - pose.y) / deltaSeconds,
      angvel: 0
    }
  };
}

export function driveVehicleBody(
  world: PhysicsWorld,
  key: string,
  kind: string,
  pose: VehicleWorldPose,
  command: VehicleControlCommand,
  deltaSeconds: number,
  modifiers: VehicleStepModifiers = {}
): VehicleWorldPose {
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
  desired: VehicleWorldPose
): VehicleBodyCapture | undefined {
  const state = world.capture(key);
  if (!state) return undefined;
  const angle = normalizeAngle(state.rotation);
  const collidedWithWorld = world.hasStaticImpact(
    key,
    desired.speed * Math.cos(desired.angle),
    desired.speed * Math.sin(desired.angle)
  ) &&
    Math.hypot(desired.x - state.x, desired.y - state.y) > WORLD_CONTACT_SHORTFALL;
  return {
    pose: {
      x: state.x,
      y: state.y,
      angle,
      speed: state.linvelX * Math.cos(angle) + state.linvelY * Math.sin(angle)
    },
    collidedWithWorld,
    impactSpeed: collidedWithWorld ? desired.speed : 0
  };
}

function normalizeAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}
