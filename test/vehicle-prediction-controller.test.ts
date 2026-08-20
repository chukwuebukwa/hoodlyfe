import assert from 'node:assert/strict';
import test from 'node:test';
import {VEHICLE_SIMULATION_STEP_SECONDS} from '../shared/simulation/vehicle-step.ts';
import {
  VehiclePredictionController,
  type VehiclePredictionAuthority,
  type VehiclePredictionWorld
} from '../src/game/network/vehicle-prediction-controller.ts';

const world: VehiclePredictionWorld = {
  step: (pose, movement) => ({
    ...pose,
    x: pose.x + movement.x * 10,
    y: pose.y - movement.y * 10,
    speed: movement.x * 10,
    linvelX: movement.x * 10,
    linvelY: -movement.y * 10,
    angvel: 0
  })
};

test('vehicle prediction advances immediately and emits ordered fixed-step input', () => {
  const controller = new VehiclePredictionController(world);
  const batch = controller.update(
    authority(),
    {x: 1, y: 0, handbrake: false},
    VEHICLE_SIMULATION_STEP_SECONDS,
    true
  );

  assert.deepEqual(batch, {
    vehicleId: 'vehicle-1',
    moves: [{sequence: 1, x: 1, y: 0}]
  });
  assert.equal(controller.pose()?.x, 110);
  assert.deepEqual(controller.snapshot(), {
    active: true,
    streaming: true,
    sequence: 1,
    acknowledgedSequence: 0,
    pendingInputs: 1,
    replayedInputs: 0,
    correctionErrorPx: 0,
    angularErrorRad: 0,
    corrections: 0,
    resets: 0,
    reason: 'predicting'
  });
});

test('authoritative acknowledgement removes confirmed vehicle input and replays the remainder', () => {
  const controller = new VehiclePredictionController(world);
  controller.update(authority(), {x: 1, y: 0, handbrake: false}, VEHICLE_SIMULATION_STEP_SECONDS, true);
  controller.update(authority(), {x: 1, y: 0, handbrake: false}, VEHICLE_SIMULATION_STEP_SECONDS, true);
  controller.update(
    authority({x: 110, linvelX: 10, speed: 10, lastVehicleInputSequence: 1}),
    {x: 0, y: 0, handbrake: false},
    0,
    true
  );

  assert.equal(controller.snapshot().acknowledgedSequence, 1);
  assert.equal(controller.snapshot().pendingInputs, 1);
  assert.equal(controller.snapshot().replayedInputs, 1);
  assert.equal(controller.pose()?.x, 120);
});

test('small vehicle corrections preserve the rendered pose and decay smoothly', () => {
  const controller = new VehiclePredictionController(world);
  controller.update(authority(), {x: 1, y: 0, handbrake: false}, VEHICLE_SIMULATION_STEP_SECONDS, true);
  const before = controller.pose()?.x ?? 0;
  controller.update(
    authority({x: 108, linvelX: 10, speed: 10, lastVehicleInputSequence: 1}),
    {x: 0, y: 0, handbrake: false},
    0,
    true
  );

  assert.equal(controller.pose()?.x, before);
  assert.equal(controller.snapshot().correctionErrorPx, 2);
  controller.update(
    authority({x: 108, linvelX: 10, speed: 10, lastVehicleInputSequence: 1}),
    {x: 0, y: 0, handbrake: false},
    VEHICLE_SIMULATION_STEP_SECONDS,
    true
  );
  assert.ok((controller.pose()?.x ?? 0) < before);
  assert.ok((controller.pose()?.x ?? 0) > 108);
});

test('airborne vehicles stream sequenced input but remain server-rendered', () => {
  const controller = new VehiclePredictionController(world);
  const batch = controller.update(
    authority({airborne: true}),
    {x: 1, y: -1, handbrake: true},
    VEHICLE_SIMULATION_STEP_SECONDS,
    true
  );

  assert.deepEqual(batch, {
    vehicleId: 'vehicle-1',
    moves: [{sequence: 1, x: 1, y: -1, handbrake: true}]
  });
  assert.equal(controller.pose(), undefined);
  assert.equal(controller.snapshot().streaming, true);
  assert.equal(controller.snapshot().reason, 'airborne-authority');
});

test('prediction fails closed for passengers and mismatched drivers', () => {
  const controller = new VehiclePredictionController(world);
  assert.equal(controller.update(
    authority({playerVehicleSeat: 1}),
    {x: 1, y: 0, handbrake: false},
    VEHICLE_SIMULATION_STEP_SECONDS,
    true
  ), undefined);
  assert.equal(controller.snapshot().reason, 'passenger');
  assert.equal(controller.update(
    authority({driverId: 'other-player'}),
    {x: 1, y: 0, handbrake: false},
    VEHICLE_SIMULATION_STEP_SECONDS,
    true
  ), undefined);
  assert.equal(controller.snapshot().reason, 'not-driver');
});

function authority(
  overrides: Partial<VehiclePredictionAuthority> = {}
): VehiclePredictionAuthority {
  return {
    playerId: 'player-1',
    vehicleId: 'vehicle-1',
    kind: 'sedan',
    surfaceId: 'street-ground',
    x: 100,
    y: 200,
    angle: 0,
    speed: 0,
    linvelX: 0,
    linvelY: 0,
    angvel: 0,
    alive: true,
    playerVehicleId: 'vehicle-1',
    playerVehicleSeat: 0,
    driverId: 'player-1',
    destroyed: false,
    airborne: false,
    engineDamage: 0,
    tyreDamageMask: 0,
    onFire: false,
    lastVehicleInputSequence: 0,
    ...overrides
  };
}
