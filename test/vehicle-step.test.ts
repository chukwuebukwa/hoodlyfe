import assert from 'node:assert/strict';
import test from 'node:test';
import {
  integrateVehicleMotion,
  integrateVehiclePose,
  VEHICLE_SIMULATION_STEP_SECONDS,
  vehicleMechanicalStepModifiers,
  vehicleSlipAngle
} from '../shared/simulation/vehicle-step.ts';
import {VEHICLE_TYRE} from '../shared/simulation/vehicle-tyre-state.ts';

test('shared vehicle step fails closed on non-finite commands and modifiers', () => {
  const pose = integrateVehiclePose(
    {x: 12, y: 34, angle: Number.NaN, speed: Number.POSITIVE_INFINITY},
    {steering: Number.NaN, throttle: Number.NEGATIVE_INFINITY},
    'sedan',
    Number.NaN,
    {maximumSpeedMultiplier: Number.NaN}
  );
  assert.deepEqual(pose, {x: 12, y: 34, angle: 0, speed: 0});
});

test('vehicle motion preserves finite lateral velocity and yaw state', () => {
  const pose = integrateVehicleMotion(
    {
      x: 12,
      y: 34,
      angle: Number.NaN,
      speed: Number.POSITIVE_INFINITY,
      linvelX: Number.NaN,
      linvelY: Number.NEGATIVE_INFINITY,
      angvel: Number.NaN
    },
    {steering: Number.NaN, throttle: Number.POSITIVE_INFINITY, handbrake: true},
    'sedan',
    Number.NaN
  );
  assert.deepEqual(pose, {
    x: 12,
    y: 34,
    angle: 0,
    speed: 0,
    linvelX: 0,
    linvelY: 0,
    angvel: 0
  });
});

test('sports cars develop more handbrake slip than normal cornering and recover', () => {
  let entry = motion();
  for (let tick = 0; tick < 120; tick++) {
    entry = integrateVehicleMotion(entry, {throttle: 1, steering: 0}, 's15', VEHICLE_SIMULATION_STEP_SECONDS);
  }
  let normal = entry;
  let drifting = entry;
  for (let tick = 0; tick < 20; tick++) {
    normal = integrateVehicleMotion(
      normal,
      {throttle: 0.75, steering: 0.8},
      's15',
      VEHICLE_SIMULATION_STEP_SECONDS
    );
    drifting = integrateVehicleMotion(
      drifting,
      {throttle: 0.75, steering: 0.8, handbrake: true},
      's15',
      VEHICLE_SIMULATION_STEP_SECONDS
    );
  }
  const normalSlip = Math.abs(vehicleSlipAngle(normal));
  const driftSlip = Math.abs(vehicleSlipAngle(drifting));
  assert.ok(normalSlip < 0.15);
  assert.ok(driftSlip > normalSlip + 0.2);
  assert.ok(driftSlip > 0.45);

  for (let tick = 0; tick < 12; tick++) {
    drifting = integrateVehicleMotion(
      drifting,
      {throttle: 0.75, steering: 0.8},
      's15',
      VEHICLE_SIMULATION_STEP_SECONDS
    );
  }
  assert.ok(Math.abs(vehicleSlipAngle(drifting)) > driftSlip * 0.8);

  for (let tick = 0; tick < 40; tick++) {
    drifting = integrateVehicleMotion(
      drifting,
      {throttle: 0.35, steering: -0.65},
      's15',
      VEHICLE_SIMULATION_STEP_SECONDS
    );
  }
  assert.ok(Math.abs(vehicleSlipAngle(drifting)) < driftSlip * 0.5);
});

test('burst tyres reduce performance and asymmetric damage creates deterministic pull', () => {
  const healthy = vehicleMechanicalStepModifiers(0, false, 0);
  const frontLeft = vehicleMechanicalStepModifiers(0, false, VEHICLE_TYRE.frontLeft);
  const bothFront = vehicleMechanicalStepModifiers(
    0,
    false,
    VEHICLE_TYRE.frontLeft | VEHICLE_TYRE.frontRight
  );
  assert.ok(frontLeft.maximumSpeedMultiplier < healthy.maximumSpeedMultiplier);
  assert.ok(bothFront.maximumSpeedMultiplier < frontLeft.maximumSpeedMultiplier);
  assert.ok(frontLeft.steeringBias < 0);
  assert.equal(bothFront.steeringBias, 0);

  const pulled = integrateVehiclePose(
    {x: 0, y: 0, angle: 0, speed: 180},
    {steering: 0, throttle: 1},
    'sedan',
    VEHICLE_SIMULATION_STEP_SECONDS,
    frontLeft
  );
  assert.ok(pulled.angle < 0);
});

function motion() {
  return {x: 0, y: 0, angle: 0, speed: 0, linvelX: 0, linvelY: 0, angvel: 0};
}
