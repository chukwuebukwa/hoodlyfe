// Movement parity spike: proves a Rapier-backed vehicle reproduces the current
// catalog handling exactly on open road. Run: npx tsx scripts/spike/rapier-movement-parity.ts
//
// Strategy under test (phase-1 migration design): the existing integrateVehiclePose
// kernel keeps computing the desired motion each tick from the same catalog handling
// curves; the Rapier body is driven by velocity writeback (linvel/angvel derived from
// the kernel's pose delta) and the engine owns contact resolution. Open-road parity
// must be bit-tight; contact response is intentionally different (engine upgrade) and
// is reported qualitatively.

import {performance} from 'node:perf_hooks';
import RAPIER from '@dimforge/rapier2d-compat';
import {
  integrateVehiclePose,
  VEHICLE_SIMULATION_STEP_SECONDS,
  type VehicleControlCommand
} from '../../shared/simulation/vehicle-step.ts';
import {VEHICLE_KINDS, vehicleDefinition} from '../../shared/content/vehicle-catalog.ts';
import type {VehicleWorldPose} from '../../shared/physics/vehicle-world-collision.ts';

const DT = VEHICLE_SIMULATION_STEP_SECONDS;
const TOTAL_SECONDS = 12;
const TOTAL_TICKS = Math.round(TOTAL_SECONDS / DT);

// Scripted maneuvers exercising every handling curve: full acceleration, sustained
// turning, braking through zero into reverse, slalom, and coasting.
function commandAt(tick: number): VehicleControlCommand {
  const seconds = tick * DT;
  if (seconds < 3) return {throttle: 1, steering: 0};
  if (seconds < 6) return {throttle: 0.6, steering: 1};
  if (seconds < 8) return {throttle: -1, steering: 0};
  if (seconds < 10) return {throttle: 1, steering: Math.sin(seconds * 2.2)};
  return {throttle: 0, steering: -0.5};
}

function normalizeAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

interface ParityResult {
  kind: string;
  maxPositionError: number;
  finalPositionError: number;
  maxAngleError: number;
  distanceTravelled: number;
}

function runParity(kind: string): ParityResult {
  // Reference: the pure kernel trajectory, exactly as the game integrates today.
  let kernelPose: VehicleWorldPose = {x: 0, y: 0, angle: 0, speed: 0};
  const kernelTrajectory: VehicleWorldPose[] = [];
  for (let tick = 0; tick < TOTAL_TICKS; tick++) {
    kernelPose = integrateVehiclePose(kernelPose, commandAt(tick), kind, DT);
    kernelTrajectory.push(kernelPose);
  }

  // Candidate: a dynamic Rapier body driven by kernel-derived velocity writeback.
  const world = new RAPIER.World({x: 0, y: 0});
  world.timestep = DT;
  const collision = vehicleDefinition(kind).collision;
  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 0).setRotation(0).setCcdEnabled(true)
  );
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(collision.length / 2, collision.width / 2).setDensity(1),
    body
  );

  let maxPositionError = 0;
  let maxAngleError = 0;
  let previousAngle = 0;
  for (let tick = 0; tick < TOTAL_TICKS; tick++) {
    const translation = body.translation();
    const angle = body.rotation();
    const linvel = body.linvel();
    const forwardSpeed = linvel.x * Math.cos(angle) + linvel.y * Math.sin(angle);
    const next = integrateVehiclePose(
      {x: translation.x, y: translation.y, angle, speed: forwardSpeed},
      commandAt(tick),
      kind,
      DT
    );
    body.setLinvel(
      {x: (next.x - translation.x) / DT, y: (next.y - translation.y) / DT},
      true
    );
    body.setAngvel(normalizeAngle(next.angle - angle) / DT, true);
    world.step();

    const reference = kernelTrajectory[tick];
    const stepped = body.translation();
    const positionError = Math.hypot(stepped.x - reference.x, stepped.y - reference.y);
    const angleError = Math.abs(normalizeAngle(body.rotation() - reference.angle));
    maxPositionError = Math.max(maxPositionError, positionError);
    maxAngleError = Math.max(maxAngleError, angleError);
    previousAngle = angle;
  }

  const finalReference = kernelTrajectory[TOTAL_TICKS - 1];
  const finalTranslation = body.translation();
  const result: ParityResult = {
    kind,
    maxPositionError,
    finalPositionError: Math.hypot(
      finalTranslation.x - finalReference.x,
      finalTranslation.y - finalReference.y
    ),
    maxAngleError,
    distanceTravelled: Math.hypot(finalReference.x, finalReference.y)
  };
  world.free();
  return result;
}

// Contact response comparison: both models drive full throttle into a wall. The kernel
// bounces at -0.2x attempted speed; Rapier resolves a physical contact. This difference
// is the intended capability upgrade, reported for the adaptation contract.
function runWallContact(kind: string): {kernelPostImpactSpeed: number; rapierPostImpactSpeed: number; rapierFinalX: number; wallX: number} {
  const wallX = 500;

  let kernelPose: VehicleWorldPose = {x: 0, y: 0, angle: 0, speed: 0};
  let kernelPostImpactSpeed = 0;
  const collision = vehicleDefinition(kind).collision;
  for (let tick = 0; tick < TOTAL_TICKS; tick++) {
    const next = integrateVehiclePose(kernelPose, {throttle: 1, steering: 0}, kind, DT);
    // Mirror resolveSweptVehicleWorldCollision's outcome for a flat wall: stop at the
    // last safe pose and invert speed to -0.2x.
    if (next.x + collision.length / 2 >= wallX) {
      kernelPostImpactSpeed = next.speed * -0.2;
      break;
    }
    kernelPose = next;
  }

  const world = new RAPIER.World({x: 0, y: 0});
  world.timestep = DT;
  const wallBody = world.createRigidBody(
    RAPIER.RigidBodyDesc.fixed().setTranslation(wallX + 20, 0)
  );
  world.createCollider(RAPIER.ColliderDesc.cuboid(20, 400), wallBody);
  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 0).setRotation(0).setCcdEnabled(true)
  );
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(collision.length / 2, collision.width / 2)
      .setDensity(1)
      .setRestitution(0.2),
    body
  );

  let contacted = false;
  let rapierPostImpactSpeed = 0;
  for (let tick = 0; tick < TOTAL_TICKS && !contacted; tick++) {
    const translation = body.translation();
    const angle = body.rotation();
    const linvel = body.linvel();
    const forwardSpeed = linvel.x * Math.cos(angle) + linvel.y * Math.sin(angle);
    const next = integrateVehiclePose(
      {x: translation.x, y: translation.y, angle, speed: forwardSpeed},
      {throttle: 1, steering: 0},
      kind,
      DT
    );
    body.setLinvel({x: (next.x - translation.x) / DT, y: (next.y - translation.y) / DT}, true);
    body.setAngvel(0, true);
    world.step();
    // Detect impact: the engine prevented the attempted advance.
    const stepped = body.translation();
    if (stepped.x + collision.length / 2 >= wallX - 1 &&
      stepped.x - translation.x < (next.x - translation.x) * 0.5) {
      contacted = true;
      const postLinvel = body.linvel();
      rapierPostImpactSpeed = postLinvel.x;
    }
  }
  const finalX = body.translation().x;
  world.free();
  return {kernelPostImpactSpeed, rapierPostImpactSpeed, rapierFinalX: finalX, wallX};
}

async function main(): Promise<void> {
  await RAPIER.init();
  console.log(`movement parity | dt=${(DT * 1000).toFixed(2)}ms | ${TOTAL_TICKS} ticks (${TOTAL_SECONDS}s) | maneuvers: accel/turn/brake+reverse/slalom/coast`);
  console.log('\nOpen-road parity (kernel reference vs Rapier velocity-writeback):');
  const started = performance.now();
  for (const kind of VEHICLE_KINDS) {
    const result = runParity(kind);
    console.log(
      `  ${result.kind.padEnd(7)} travelled=${result.distanceTravelled.toFixed(0)}px ` +
      `maxPosErr=${result.maxPositionError.toExponential(2)}px ` +
      `finalPosErr=${result.finalPositionError.toExponential(2)}px ` +
      `maxAngleErr=${result.maxAngleError.toExponential(2)}rad`
    );
  }
  console.log(`  (${(performance.now() - started).toFixed(0)}ms for ${VEHICLE_KINDS.length} kinds x ${TOTAL_TICKS} ticks)`);

  console.log('\nWall contact response (intentional behavior change, for the contract):');
  const wall = runWallContact('sedan');
  console.log(
    `  kernel: bounce to ${wall.kernelPostImpactSpeed.toFixed(1)}px/s (authored -0.2x rule)\n` +
    `  rapier: post-impact forward speed ${wall.rapierPostImpactSpeed.toFixed(1)}px/s, ` +
    `rest at x=${wall.rapierFinalX.toFixed(1)} against wall face x=${wall.wallX}`
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
