import assert from 'node:assert/strict';
import test from 'node:test';
import {vehicleSkidMarkPresentation} from '../src/game/rendering/vehicle-skid-mark-policy.ts';
import {
  integrateVehicleMotion,
  VEHICLE_SIMULATION_STEP_SECONDS
} from '../shared/simulation/vehicle-step.ts';

test('skid marks require lateral slip and originate at both rear tyres', () => {
  const planted = vehicleSkidMarkPresentation({
    x: 100,
    y: 200,
    angle: 0,
    linvelX: 220,
    linvelY: 0,
    kind: 's15'
  });
  assert.equal(planted.active, false);

  const sliding = vehicleSkidMarkPresentation({
    x: 100,
    y: 200,
    angle: 0,
    linvelX: 180,
    linvelY: 110,
    kind: 's15'
  });
  assert.equal(sliding.active, true);
  assert.ok(sliding.intensity > 0);
  assert.ok(sliding.rearLeft.x < 100);
  assert.ok(sliding.rearLeft.y < 200);
  assert.ok(sliding.rearRight.x < 100);
  assert.ok(sliding.rearRight.y > 200);
});

test('skid presentation persists after handbrake release and clears after recovery', () => {
  let vehicle = motion();
  for (let tick = 0; tick < 120; tick++) {
    vehicle = integrateVehicleMotion(
      vehicle,
      {throttle: 1, steering: 0},
      's15',
      VEHICLE_SIMULATION_STEP_SECONDS
    );
  }
  for (let tick = 0; tick < 20; tick++) {
    vehicle = integrateVehicleMotion(
      vehicle,
      {throttle: 0.75, steering: 0.8, handbrake: true},
      's15',
      VEHICLE_SIMULATION_STEP_SECONDS
    );
  }
  for (let tick = 0; tick < 12; tick++) {
    vehicle = integrateVehicleMotion(
      vehicle,
      {throttle: 0.75, steering: 0.8},
      's15',
      VEHICLE_SIMULATION_STEP_SECONDS
    );
  }
  assert.equal(vehicleSkidMarkPresentation({...vehicle, kind: 's15'}).active, true);

  for (let tick = 0; tick < 40; tick++) {
    vehicle = integrateVehicleMotion(
      vehicle,
      {throttle: 0.35, steering: -0.65},
      's15',
      VEHICLE_SIMULATION_STEP_SECONDS
    );
  }
  assert.equal(vehicleSkidMarkPresentation({...vehicle, kind: 's15'}).active, false);
});

test('destroyed vehicles never paint skid marks', () => {
  const presentation = vehicleSkidMarkPresentation({
    x: 0,
    y: 0,
    angle: 0,
    linvelX: 180,
    linvelY: 120,
    kind: 'r33',
    destroyed: true
  });
  assert.equal(presentation.active, false);
});

function motion() {
  return {x: 0, y: 0, angle: 0, speed: 0, linvelX: 0, linvelY: 0, angvel: 0};
}
