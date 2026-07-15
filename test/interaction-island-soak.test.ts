import assert from 'node:assert/strict';
import test from 'node:test';
import {
  M11_ACCEPTANCE_PROFILE,
  M11_STRESS_PROFILE,
  runInteractionIslandSoak,
  type InteractionIslandSoakResult
} from './support/interaction-island-soak.ts';

const STRICT_REPLAY_P95_MS = 2;
const SHARED_RUNNER_REPLAY_P95_MS = 8;

test('multi-client interaction islands survive the M11 impairment and lifecycle soak', (context) => {
  const acceptance = runInteractionIslandSoak(M11_ACCEPTANCE_PROFILE, 450, 0x51a7);
  const stress = runInteractionIslandSoak(M11_STRESS_PROFILE, 450, 0x8e55);
  for (const result of [acceptance, stress]) {
    context.diagnostic(summary(result));
    assert.equal(result.clients, 8);
    assert.ok(result.successfulReplays > 1_000, summary(result));
    assert.equal(result.rejectedReplays, 0, summary(result));
    assert.ok(result.maximumReplayTicks <= 24, summary(result));
    assert.ok(result.maximumIslandBodies > 1, summary(result));
    assert.ok(result.maximumWeightedPoints <= 32, summary(result));
    assert.equal(result.budgetViolations, 0, summary(result));
    assert.ok(result.overflowSelections > 0, summary(result));
    assert.equal(result.executedExternalEffects, 0, summary(result));
    assert.ok(result.suppressedExternalEffects > 0, summary(result));
    assert.ok(result.simulatedRetransmissions > 0, summary(result));
    assert.equal(result.occupancyTransitionsObserved, 2, summary(result));
    assert.equal(result.historyResetsObserved, 2, summary(result));
    assert.equal(result.streamOutObserved, true, summary(result));
    assert.equal(result.streamInObserved, true, summary(result));
    assert.equal(result.destructionObserved, true, summary(result));
    assert.equal(result.vehicleRespawnObserved, true, summary(result));
    assert.equal(result.humanoidRespawnObserved, true, summary(result));
    assert.ok(result.rootErrorP95 < 48, summary(result));
    assert.ok(result.rootErrorMaximum < 180, summary(result));
    assert.ok(result.finalConvergenceError < 1e-9, summary(result));
  }
  const replayP95Limit = process.env.NETCODE_SOAK_STRICT === '1'
    ? STRICT_REPLAY_P95_MS
    : SHARED_RUNNER_REPLAY_P95_MS;
  assert.ok(acceptance.replayDurationP95Ms < replayP95Limit, summary(acceptance));
});

test('the M11 acceptance trace is deterministic outside wall-clock measurements', () => {
  const first = deterministicProjection(runInteractionIslandSoak(M11_ACCEPTANCE_PROFILE, 360, 77));
  const second = deterministicProjection(runInteractionIslandSoak(M11_ACCEPTANCE_PROFILE, 360, 77));
  assert.deepEqual(second, first);
});

function deterministicProjection(result: InteractionIslandSoakResult) {
  const {
    replayDurationP95Ms: _replayDurationP95Ms,
    replayDurationMaximumMs: _replayDurationMaximumMs,
    ...deterministic
  } = result;
  return deterministic;
}

function summary(result: InteractionIslandSoakResult): string {
  return `${result.profile.roundTripTimeMs}ms/${result.profile.jitterMs}ms/` +
    `${(result.profile.packetLossRate * 100).toFixed(1)}%: ` +
    `replays=${result.successfulReplays} bodies=${result.maximumIslandBodies} ` +
    `points=${result.maximumWeightedPoints}/32 overflow=${result.overflowSelections} ` +
    `replay-p95=${result.replayDurationP95Ms.toFixed(3)}ms ` +
    `error-p95=${result.rootErrorP95.toFixed(2)}px ` +
    `error-max=${result.rootErrorMaximum.toFixed(2)}px ` +
    `retransmits=${result.simulatedRetransmissions}`;
}
