import assert from 'node:assert/strict';
import test from 'node:test';
import {ReplaySideEffectGate} from '../src/game/prediction/replay-side-effect-gate.ts';

test('replay gate permits pure state and suppresses every external side-effect class', () => {
  const gate = new ReplaySideEffectGate();
  let pureState = 0;
  let presentation = 0;
  let gameplay = 0;
  gate.runReplay(() => {
    assert.equal(gate.replaying(), true);
    gate.dispatch('pure-state', () => pureState++);
    gate.dispatch('idempotent-presentation', () => presentation++);
    gate.dispatch('one-shot-presentation', () => presentation++);
    gate.dispatch('authoritative-gameplay', () => gameplay++);
    gate.dispatch('durable-transaction', () => gameplay++);
  });
  assert.equal(gate.replaying(), false);
  assert.equal(pureState, 1);
  assert.equal(presentation, 0);
  assert.equal(gameplay, 0);
  assert.deepEqual(gate.suppressed(), {
    'idempotent-presentation': 1,
    'one-shot-presentation': 1,
    'authoritative-gameplay': 1,
    'durable-transaction': 1
  });
  assert.equal(gate.dispatch('one-shot-presentation', () => presentation++), true);
  assert.equal(presentation, 1);
});

test('replay gate restores live mode when a replay kernel throws', () => {
  const gate = new ReplaySideEffectGate();
  assert.throws(() => gate.runReplay(() => {
    throw new Error('kernel failed');
  }));
  assert.equal(gate.replaying(), false);
});
