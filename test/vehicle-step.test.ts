import assert from 'node:assert/strict';
import test from 'node:test';
import {
  integrateVehiclePose,
  VEHICLE_SIMULATION_STEP_SECONDS,
  vehicleMechanicalStepModifiers
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
