import assert from 'node:assert/strict';
import {test} from 'node:test';
import {approach, clamp, finite, finiteClamp, normalizeAngle, shortestAngle} from '../../engine/core/math';
import {cross, dot, normalize, perp} from '../../engine/core/vec';

test('finite passes numbers and replaces non-finite values', () => {
  assert.equal(finite(3.5), 3.5);
  assert.equal(finite(Number.NaN), 0);
  assert.equal(finite(Number.POSITIVE_INFINITY, 7), 7);
});

test('finiteClamp clamps and sanitizes', () => {
  assert.equal(finiteClamp(5, 0, 3), 3);
  assert.equal(finiteClamp(-1, 0, 3), 0);
  assert.equal(finiteClamp(Number.NaN, 0, 3, 2), 2);
});

test('normalizeAngle matches the vehicle-step convention', () => {
  assert.equal(normalizeAngle(0), 0);
  assert.ok(Math.abs(normalizeAngle(Math.PI * 3) - Math.PI * (Math.PI * 3 > 0 ? 1 : 1)) < 1e-9 || Math.abs(Math.abs(normalizeAngle(Math.PI * 3)) - Math.PI) < 1e-9);
  assert.ok(Math.abs(normalizeAngle(-Math.PI / 2) + Math.PI / 2) < 1e-12);
});

test('shortestAngle picks the short way around', () => {
  assert.ok(Math.abs(shortestAngle(0.1, -0.1) + 0.2) < 1e-12);
  assert.ok(Math.abs(shortestAngle(Math.PI - 0.1, -Math.PI + 0.1) - 0.2) < 1e-9);
});

test('approach moves by at most maxDelta and lands exactly', () => {
  assert.equal(approach(0, 10, 3), 3);
  assert.equal(approach(9, 10, 3), 10);
  assert.equal(approach(10, 0, 4), 6);
  assert.equal(clamp(5, 0, 4), 4);
});

test('vec helpers follow y-down conventions', () => {
  assert.equal(dot(1, 0, 0, 1), 0);
  assert.equal(cross(1, 0, 0, 1), 1);
  const p = perp({x: 1, y: 0});
  assert.deepEqual(p, {x: -0, y: 1});
  const n = normalize(3, 4);
  assert.ok(Math.abs(n.x - 0.6) < 1e-12 && Math.abs(n.y - 0.8) < 1e-12);
  assert.deepEqual(normalize(0, 0), {x: 0, y: 0});
});
