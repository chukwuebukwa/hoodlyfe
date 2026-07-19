import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SavedVehiclePrediction,
  VEHICLE_PREDICTION_STEP_SECONDS
} from '../src/game/prediction/saved-vehicle-prediction.ts';
import {integrateVehiclePose} from '../shared/simulation/vehicle-step.ts';

const openWorld = () => true;
const prediction = () => new SavedVehiclePrediction(
  (pose, movement, kind, deltaSeconds, _canOccupy, modifiers) => integrateVehiclePose(
    pose,
    {steering: movement.x, throttle: -movement.y},
    kind,
    deltaSeconds,
    modifiers
  )
);

test('saved vehicle prediction waits for a fixed step before advancing physics', () => {
  const saved = prediction();
  saved.initialize({x: 0, y: 0, angle: 0, speed: 0}, 40);
  const half = saved.advance({x: 0, y: -1}, 'sedan', VEHICLE_PREDICTION_STEP_SECONDS / 2, openWorld);
  assert.equal(half.outboundMoves.length, 0);
  assert.deepEqual(half.pose, {x: 0, y: 0, angle: 0, speed: 0});
  const full = saved.advance({x: 0, y: -1}, 'sedan', VEHICLE_PREDICTION_STEP_SECONDS / 2, openWorld);
  assert.deepEqual(full.outboundMoves, [{sequence: 41, x: 0, y: -1}]);
});

test('authoritative acknowledgement rewinds and replays only pending vehicle moves', () => {
  const saved = prediction();
  saved.initialize({x: 0, y: 0, angle: 0, speed: 0});
  saved.advance({x: 0, y: -1}, 'sedan', VEHICLE_PREDICTION_STEP_SECONDS * 3, openWorld);
  const correction = saved.reconcile(
    {x: 10, y: 0, angle: 0, speed: 13},
    1,
    'sedan',
    openWorld
  );
  assert.equal(correction.resimulated, true);
  assert.equal(correction.pendingMoveCount, 2);
  assert.equal(saved.pendingMoveCount(), 2);
  assert.ok(correction.pose.x > 10);
});

test('acknowledgement outside retained history fails closed with one hard reset', () => {
  const saved = prediction();
  saved.initialize({x: 0, y: 0, angle: 0, speed: 0});
  saved.advance({x: 0, y: -1}, 'sedan', VEHICLE_PREDICTION_STEP_SECONDS, openWorld);
  const correction = saved.reconcile(
    {x: 50, y: 20, angle: 0.5, speed: 40},
    500,
    'sedan',
    openWorld
  );
  assert.equal(correction.hardCorrection, true);
  assert.deepEqual(correction.pose, {x: 50, y: 20, angle: 0.5, speed: 40});
  assert.equal(saved.pendingMoveCount(), 0);
});

test('small historical error retires acknowledged moves without resimulation', () => {
  const saved = prediction();
  saved.initialize({x: 0, y: 0, angle: 0, speed: 0});
  const advanced = saved.advance(
    {x: 0, y: -1},
    'sedan',
    VEHICLE_PREDICTION_STEP_SECONDS * 2,
    openWorld
  );
  const correction = saved.reconcile(
    {x: advanced.pose.x - 0.5, y: 0, angle: 0.005, speed: advanced.pose.speed - 1},
    2,
    'sedan',
    openWorld
  );
  assert.equal(correction.resimulated, false);
  assert.equal(correction.pendingMoveCount, 0);
  assert.equal(saved.pendingMoveCount(), 0);
});
