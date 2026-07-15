import assert from 'node:assert/strict';
import test from 'node:test';
import {
  angleCorrectionOffset,
  decayCorrectionOffset,
  positionCorrectionOffset
} from '../src/game/rendering/correction-smoothing.ts';

test('correction smoothing keeps canonical simulation immediate and decays presentation only', () => {
  assert.deepEqual(positionCorrectionOffset(100, 80, 90, 70, false), {x: 10, y: 10});
  assert.deepEqual(positionCorrectionOffset(100, 80, 90, 70, true), {x: 0, y: 0});
  assert.ok(Math.abs(angleCorrectionOffset(-Math.PI + 0.1, Math.PI - 0.1, false) - 0.2) < 1e-9);
  const first = decayCorrectionOffset(10, 1 / 60, 12);
  const second = decayCorrectionOffset(first, 1 / 60, 12);
  assert.ok(first < 10 && first > 0);
  assert.ok(second < first && second > 0);
  assert.equal(decayCorrectionOffset(Number.NaN, 1, 12), 0);
});
