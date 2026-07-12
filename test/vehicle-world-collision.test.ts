import assert from 'node:assert/strict';
import test from 'node:test';
import {
  orientedVehicleCanOccupy,
  resolveSweptVehicleWorldCollision
} from '../shared/physics/vehicle-world-collision.ts';

test('oriented vehicle occupancy uses the catalog rectangle instead of a center radius', () => {
  const sampled: Array<{x: number; y: number}> = [];
  const clear = orientedVehicleCanOccupy(
    {x: 100, y: 100, angle: Math.PI / 2},
    'sedan',
    (x, y) => {
      sampled.push({x, y});
      return true;
    }
  );
  assert.equal(clear, true);
  assert.equal(sampled.length, 15);
  assert.ok(Math.max(...sampled.map(({y}) => y)) - Math.min(...sampled.map(({y}) => y)) > 55);
  assert.ok(Math.max(...sampled.map(({x}) => x)) - Math.min(...sampled.map(({x}) => x)) > 30);
});

test('swept oriented vehicle collision catches a wall crossed between endpoints', () => {
  const result = resolveSweptVehicleWorldCollision(
    {x: 20, y: 100, angle: 0, speed: 300},
    {x: 100, y: 100, angle: 0, speed: 300},
    'sedan',
    (x) => x < 72 || x > 78
  );
  assert.equal(result.collided, true);
  assert.ok(result.sweepSteps > 1);
  assert.ok(result.pose.x < 72);
  assert.equal(result.pose.speed, -60);
});

test('swept oriented collision accepts a clear translated and rotated pose', () => {
  const attempted = {x: 60, y: 75, angle: 0.4, speed: 120};
  const result = resolveSweptVehicleWorldCollision(
    {x: 50, y: 70, angle: 0.1, speed: 100},
    attempted,
    'taxi',
    () => true
  );
  assert.equal(result.collided, false);
  assert.deepEqual(result.pose, attempted);
});
