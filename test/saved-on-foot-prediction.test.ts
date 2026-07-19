import assert from 'node:assert/strict';
import test from 'node:test';
import {SavedOnFootPrediction} from '../src/game/prediction/saved-on-foot-prediction.ts';
import {
  integrateOnFootPose,
  ON_FOOT_SIMULATION_STEP_SECONDS
} from '../shared/simulation/on-foot-step.ts';

const canOccupy = (_spaceId: string, x: number, y: number) => (
  x >= 0 && y >= 0 && x <= 500 && y <= 500
);
const prediction = () => new SavedOnFootPrediction(
  (pose, command, deltaSeconds, _canOccupy, modifiers) =>
    integrateOnFootPose(pose, command, deltaSeconds, modifiers)
);

test('saved on-foot prediction waits for a fixed step before advancing physics', () => {
  const saved = prediction();
  saved.initialize({x: 100, y: 100, spaceId: 'street'});
  const partial = saved.advance({x: 1, y: 0}, 1 / 60, canOccupy);
  assert.deepEqual(partial.pose, {x: 100, y: 100, spaceId: 'street'});
  assert.equal(partial.outboundMoves.length, 0);
  const fixed = saved.advance({x: 1, y: 0}, 1 / 60, canOccupy);
  assert.equal(fixed.outboundMoves.length, 1);
  assert.equal(fixed.outboundMoves[0].sequence, 1);
  assert.ok(Math.abs(fixed.pose.x - (100 + 190 / 30)) < 1e-9);
});

test('saved on-foot reconciliation restores one baseline and replays pending moves', () => {
  const saved = prediction();
  saved.initialize({x: 100, y: 100, spaceId: 'street'});
  saved.advance({x: 1, y: 0}, ON_FOOT_SIMULATION_STEP_SECONDS * 3, canOccupy);
  const correction = saved.reconcile(
    {x: 105, y: 100, spaceId: 'street'},
    1,
    canOccupy
  );
  assert.equal(correction.resimulated, true);
  assert.equal(correction.pendingMoveCount, 2);
  assert.ok(Math.abs(correction.pose.x - (105 + 190 / 30 * 2)) < 1e-9);
});

test('saved on-foot prediction hard-corrects authoritative space transitions', () => {
  const saved = prediction();
  saved.initialize({x: 100, y: 100, spaceId: 'street'});
  saved.advance({x: 0, y: -1}, ON_FOOT_SIMULATION_STEP_SECONDS, canOccupy);
  const correction = saved.reconcile(
    {x: 2600, y: 1880, spaceId: 'mercy-hospital'},
    1,
    () => true
  );
  assert.equal(correction.spaceChanged, true);
  assert.equal(correction.hardCorrection, true);
  assert.deepEqual(correction.pose, {x: 2600, y: 1880, spaceId: 'mercy-hospital'});
});

test('saved on-foot interaction replay atomically replaces contiguous pending poses', () => {
  const saved = prediction();
  saved.initialize({x: 100, y: 100, spaceId: 'street'}, 10);
  saved.advance(
    {x: 1, y: 0},
    ON_FOOT_SIMULATION_STEP_SECONDS * 2,
    canOccupy,
    0.6
  );
  assert.deepEqual(saved.pendingMovesAfter(10), [
    {sequence: 11, x: 1, y: 0, movementScale: 0.6},
    {sequence: 12, x: 1, y: 0, movementScale: 0.6}
  ]);
  assert.equal(saved.applyInteractionReplay(10, [{
    sequence: 12,
    pose: {x: 120, y: 100, spaceId: 'street'}
  }]), undefined, 'A partial replay must fail without mutating history.');
  assert.equal(saved.pendingMovesAfter(10)?.length, 2);
  const correction = saved.applyInteractionReplay(10, [
    {sequence: 11, pose: {x: 108, y: 100, spaceId: 'street'}},
    {sequence: 12, pose: {x: 116, y: 100, spaceId: 'street'}}
  ]);
  assert.equal(correction?.resimulated, true);
  assert.deepEqual(correction?.pose, {x: 116, y: 100, spaceId: 'street'});
  assert.equal(correction?.pendingMoveCount, 2);
});
