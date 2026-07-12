import assert from 'node:assert/strict';
import test from 'node:test';
import {
  predictVehiclePose,
  predictVehiclePoseWithWorldCollision
} from '../src/game/prediction/vehicle-prediction-policy.ts';

test('vehicle prediction mirrors authoritative wall rejection and rebound', () => {
  const pose = {x: 100, y: 100, angle: 0, speed: 180};
  let observedRadius = 0;
  const predicted = predictVehiclePoseWithWorldCollision(
    pose,
    {x: 0, y: -1},
    'sedan',
    1 / 30,
    (_x, _y, radius) => {
      observedRadius = radius;
      return false;
    }
  );
  assert.equal(predicted.x, pose.x);
  assert.equal(predicted.y, pose.y);
  assert.equal(observedRadius, 1.5);
  assert.ok(predicted.speed < 0);
});

test('local vehicle prediction responds immediately and mirrors forward, brake, and steering policy', () => {
  let pose = {x: 0, y: 0, angle: 0, speed: 0};
  pose = predictVehiclePose(pose, {x: 0, y: -1}, 'sedan', 1 / 30);
  assert.ok(pose.speed > 0);
  assert.ok(pose.x > 0);
  const forwardSpeed = pose.speed;
  pose = predictVehiclePose(pose, {x: 1, y: -1}, 'sedan', 1 / 30);
  assert.ok(pose.angle > 0);
  pose = predictVehiclePose(pose, {x: 0, y: 1}, 'sedan', 1 / 30);
  assert.ok(pose.speed < forwardSpeed + 20, 'Opposite throttle should brake before reversing.');
});
