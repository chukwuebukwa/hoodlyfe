import test from 'node:test';
import assert from 'node:assert/strict';
import {projectPositionalAudio} from '../src/game/audio/positional-audio-policy.ts';

test('positional audio attenuates by distance and clamps pan', () => {
  const near = projectPositionalAudio({x: 0, y: 0}, {x: 100, y: 0, maxDistance: 1_000}, 1);
  const far = projectPositionalAudio({x: 0, y: 0}, {x: 800, y: 0, maxDistance: 1_000}, 1);
  const out = projectPositionalAudio({x: 0, y: 0}, {x: 1_400, y: 0, maxDistance: 1_000}, 1);

  assert.equal(near.gain > far.gain, true);
  assert.equal(far.gain > out.gain, true);
  assert.equal(out.gain, 0);
  assert.equal(near.pan > 0, true);
  assert.equal(projectPositionalAudio({x: 0, y: 0}, {x: -2_000, y: 0, maxDistance: 3_000}, 1).pan, -1);
});
