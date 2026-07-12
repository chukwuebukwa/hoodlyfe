import assert from 'node:assert/strict';
import test from 'node:test';
import {LocalMovementReplay} from '../src/game/prediction/local-movement-replay.ts';

test('local movement replay rebuilds unobserved movement across input changes', () => {
  const replay = new LocalMovementReplay();
  replay.record(100, {x: 1, y: 0});
  replay.record(200, {x: 0, y: -1});
  assert.deepEqual(replay.replay({x: 10, y: 20}, 150, 250, 100), {x: 15, y: 15});
});

test('local movement replay ignores duplicate samples and empty time spans', () => {
  const replay = new LocalMovementReplay();
  replay.record(100, {x: 1, y: 0});
  replay.record(120, {x: 1, y: 0});
  assert.deepEqual(replay.replay({x: 4, y: 5}, 200, 200, 190), {x: 4, y: 5});
});

test('local movement replay bounds stale clock history to the network horizon', () => {
  const replay = new LocalMovementReplay();
  replay.record(0, {x: 1, y: 0});
  assert.deepEqual(replay.replay({x: 0, y: 0}, 0, 2_000, 100), {x: 25, y: 0});
});
