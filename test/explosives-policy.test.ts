import assert from 'node:assert/strict';
import test from 'node:test';
import {blastFalloff} from '../shared/content/explosives.ts';

test('blast falloff preserves a full inner half and linearly fades the outer half', () => {
  assert.equal(blastFalloff(0, 100), 1);
  assert.equal(blastFalloff(50, 100), 1);
  assert.equal(blastFalloff(75, 100), 0.5);
  assert.equal(blastFalloff(99, 100), 0.02);
  assert.equal(blastFalloff(100, 100), 0);
  assert.equal(blastFalloff(20, 0), 0);
  assert.equal(blastFalloff(Number.NaN, 100), 0);
});
