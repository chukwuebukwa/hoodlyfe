import assert from 'node:assert/strict';
import test from 'node:test';
import {SavedOnFootPrediction} from '../src/game/prediction/saved-on-foot-prediction.ts';
import {ON_FOOT_SIMULATION_STEP_SECONDS} from '../shared/simulation/on-foot-step.ts';

const canOccupy = (_spaceId: string, x: number, y: number) => (
  x >= 0 && y >= 0 && x <= 500 && y <= 500
);

test('saved on-foot prediction responds immediately and emits fixed-tick moves', () => {
  const prediction = new SavedOnFootPrediction();
  prediction.initialize({x: 100, y: 100, spaceId: 'street'});
  const partial = prediction.advance({x: 1, y: 0}, 1 / 60, canOccupy);
  assert.ok(partial.pose.x > 100, 'Fractional presentation must respond on the first render frame.');
  assert.equal(partial.outboundMoves.length, 0);
  const fixed = prediction.advance({x: 1, y: 0}, 1 / 60, canOccupy);
  assert.equal(fixed.outboundMoves.length, 1);
  assert.equal(fixed.outboundMoves[0].sequence, 1);
  assert.ok(Math.abs(fixed.pose.x - (100 + 190 / 30)) < 1e-9);
});

test('saved on-foot reconciliation restores one baseline and replays pending moves', () => {
  const prediction = new SavedOnFootPrediction();
  prediction.initialize({x: 100, y: 100, spaceId: 'street'});
  prediction.advance({x: 1, y: 0}, ON_FOOT_SIMULATION_STEP_SECONDS * 3, canOccupy);
  const correction = prediction.reconcile(
    {x: 105, y: 100, spaceId: 'street'},
    1,
    canOccupy
  );
  assert.equal(correction.resimulated, true);
  assert.equal(correction.pendingMoveCount, 2);
  assert.ok(Math.abs(correction.pose.x - (105 + 190 / 30 * 2)) < 1e-9);
});

test('saved on-foot prediction hard-corrects authoritative space transitions', () => {
  const prediction = new SavedOnFootPrediction();
  prediction.initialize({x: 100, y: 100, spaceId: 'street'});
  prediction.advance({x: 0, y: -1}, ON_FOOT_SIMULATION_STEP_SECONDS, canOccupy);
  const correction = prediction.reconcile(
    {x: 2600, y: 1880, spaceId: 'mercy-hospital'},
    1,
    () => true
  );
  assert.equal(correction.spaceChanged, true);
  assert.equal(correction.hardCorrection, true);
  assert.deepEqual(correction.pose, {x: 2600, y: 1880, spaceId: 'mercy-hospital'});
});
