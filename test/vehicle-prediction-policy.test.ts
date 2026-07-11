import assert from 'node:assert/strict';
import test from 'node:test';
import {
  predictVehiclePose,
  reconcileVehiclePose
} from '../src/game/prediction/vehicle-prediction-policy.ts';

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

test('vehicle reconciliation blends small error frame-rate independently and snaps unsafe divergence', () => {
  const predicted = {x: 0, y: 0, angle: Math.PI - 0.05, speed: 100};
  const authoritative = {x: 20, y: 0, angle: -Math.PI + 0.05, speed: 80};
  const sixtyFps = reconcileVehiclePose(predicted, authoritative, 1 / 60);
  const thirtyFps = reconcileVehiclePose(predicted, authoritative, 1 / 30);
  assert.equal(sixtyFps.snapped, false);
  assert.ok(sixtyFps.pose.x > 0 && sixtyFps.pose.x < thirtyFps.pose.x);
  assert.ok(Math.abs(sixtyFps.pose.angle) > 3, 'Rotation should take the wrapped shortest path.');

  const snapped = reconcileVehiclePose(predicted, {...authoritative, x: 400}, 1 / 60);
  assert.equal(snapped.snapped, true);
  assert.deepEqual(snapped.pose, {...authoritative, x: 400});
});
