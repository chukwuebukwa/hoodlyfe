import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SavedVehiclePrediction,
  VEHICLE_PREDICTION_STEP_SECONDS
} from '../src/game/prediction/saved-vehicle-prediction.ts';

const openWorld = () => true;

test('saved vehicle prediction emits one numbered move per fixed simulation step', () => {
  const prediction = new SavedVehiclePrediction();
  prediction.initialize({x: 0, y: 0, angle: 0, speed: 0}, 40);
  const half = prediction.advance({x: 0, y: -1}, 'sedan', VEHICLE_PREDICTION_STEP_SECONDS / 2, openWorld);
  assert.equal(half.outboundMoves.length, 0);
  assert.ok(half.pose.x > 0, 'Residual render prediction should respond before the first fixed tick.');
  const full = prediction.advance({x: 0, y: -1}, 'sedan', VEHICLE_PREDICTION_STEP_SECONDS / 2, openWorld);
  assert.deepEqual(full.outboundMoves, [{sequence: 41, x: 0, y: -1}]);
});

test('authoritative acknowledgement rewinds and replays only pending vehicle moves', () => {
  const prediction = new SavedVehiclePrediction();
  prediction.initialize({x: 0, y: 0, angle: 0, speed: 0});
  prediction.advance({x: 0, y: -1}, 'sedan', VEHICLE_PREDICTION_STEP_SECONDS * 3, openWorld);
  const correction = prediction.reconcile(
    {x: 10, y: 0, angle: 0, speed: 13},
    1,
    'sedan',
    openWorld
  );
  assert.equal(correction.resimulated, true);
  assert.equal(correction.pendingMoveCount, 2);
  assert.equal(prediction.pendingMoveCount(), 2);
  assert.ok(correction.pose.x > 10);
});

test('saved prediction mirrors blocked world collision during replay', () => {
  const prediction = new SavedVehiclePrediction();
  prediction.initialize({x: 0, y: 0, angle: 0, speed: 180});
  prediction.advance({x: 0, y: -1}, 'sedan', VEHICLE_PREDICTION_STEP_SECONDS * 2, openWorld);
  const correction = prediction.reconcile(
    {x: 0, y: 0, angle: 0, speed: 180},
    1,
    'sedan',
    () => false
  );
  assert.equal(correction.pose.x, 0);
  assert.ok(correction.pose.speed < 0);
});

test('acknowledgement outside retained history fails closed with one hard reset', () => {
  const prediction = new SavedVehiclePrediction();
  prediction.initialize({x: 0, y: 0, angle: 0, speed: 0});
  prediction.advance({x: 0, y: -1}, 'sedan', VEHICLE_PREDICTION_STEP_SECONDS, openWorld);
  const correction = prediction.reconcile(
    {x: 50, y: 20, angle: 0.5, speed: 40},
    500,
    'sedan',
    openWorld
  );
  assert.equal(correction.hardCorrection, true);
  assert.deepEqual(correction.pose, {x: 50, y: 20, angle: 0.5, speed: 40});
  assert.equal(prediction.pendingMoveCount(), 0);
});

test('small historical error retires acknowledged moves without resimulation', () => {
  const prediction = new SavedVehiclePrediction();
  prediction.initialize({x: 0, y: 0, angle: 0, speed: 0});
  const advanced = prediction.advance(
    {x: 0, y: -1},
    'sedan',
    VEHICLE_PREDICTION_STEP_SECONDS * 2,
    openWorld
  );
  const correction = prediction.reconcile(
    {x: advanced.pose.x - 0.5, y: 0, angle: 0.005, speed: advanced.pose.speed - 1},
    2,
    'sedan',
    openWorld
  );
  assert.equal(correction.resimulated, false);
  assert.equal(correction.pendingMoveCount, 0);
  assert.equal(prediction.pendingMoveCount(), 0);
});
