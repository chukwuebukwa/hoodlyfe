import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AIRBORNE_GRAVITY,
  stepAirborneMotion
} from '../shared/simulation/airborne-motion.ts';

test('airborne motion preserves planar momentum and integrates gravity', () => {
  const stepped = stepAirborneMotion({
    x: 10,
    y: 20,
    angle: 0.25,
    elevation: 128,
    verticalVelocity: 120,
    velocityX: 80,
    velocityY: -40,
    angularVelocity: 2
  }, 0.05);

  assert.equal(stepped.x, 14);
  assert.equal(stepped.y, 18);
  assert.equal(stepped.previousElevation, 128);
  assert.equal(stepped.verticalVelocity, 120 - AIRBORNE_GRAVITY * 0.05);
  assert.equal(stepped.elevation, 128 + 120 * 0.05 - AIRBORNE_GRAVITY * 0.05 ** 2 / 2);
  assert.ok(Math.abs(stepped.angle - 0.35) < 0.0001);
});

test('airborne motion clamps unusually long frame deltas', () => {
  const stepped = stepAirborneMotion({
    x: 0,
    y: 0,
    angle: 0,
    elevation: 64,
    verticalVelocity: 0,
    velocityX: 100,
    velocityY: 0
  }, 1);

  assert.equal(stepped.x, 5);
  assert.equal(stepped.verticalVelocity, -AIRBORNE_GRAVITY * 0.05);
});
