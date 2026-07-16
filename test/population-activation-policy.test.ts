import assert from 'node:assert/strict';
import test from 'node:test';
import {
  POPULATION_INTEREST,
  populationInterestAt
} from '../server/game/population/population-activation-policy.ts';
import {STREET_STREAMING} from '../server/game/replication/street-streaming-policy.ts';

test('prewarm population enters replication before crossing the protected view boundary', () => {
  assert.ok(POPULATION_INTEREST.protectedViewRadius < STREET_STREAMING.enterRadius);
  assert.equal(POPULATION_INTEREST.prewarmRadius, STREET_STREAMING.enterRadius);
  assert.equal(POPULATION_INTEREST.retentionRadius, STREET_STREAMING.exitRadius);
});

test('population interest classifies hot, prewarm, retained, and cold tiers', () => {
  const anchors = [{x: 0, y: 0}];
  assert.equal(populationInterestAt(100, 0, anchors).tier, 'hot');
  assert.equal(
    populationInterestAt(POPULATION_INTEREST.protectedViewRadius + 1, 0, anchors).tier,
    'prewarm'
  );
  assert.equal(
    populationInterestAt(POPULATION_INTEREST.prewarmRadius + 1, 0, anchors).tier,
    'retained'
  );
  assert.equal(
    populationInterestAt(POPULATION_INTEREST.retentionRadius + 1, 0, anchors).tier,
    'cold'
  );
});

test('ambient actors materialize only in the prewarm ring', () => {
  const anchors = [{x: 0, y: 0}];
  assert.equal(populationInterestAt(0, 0, anchors).materialize, false);
  assert.equal(
    populationInterestAt(POPULATION_INTEREST.protectedViewRadius + 1, 0, anchors).materialize,
    true
  );
  assert.equal(
    populationInterestAt(POPULATION_INTEREST.prewarmRadius + 1, 0, anchors).materialize,
    false
  );
});

test('one nearby player protects a spawn from every other player anchor', () => {
  const anchors = [{x: 0, y: 0}, {x: 1_400, y: 0}];
  const decision = populationInterestAt(1_400, 0, anchors);
  assert.equal(decision.distance, 0);
  assert.equal(decision.tier, 'hot');
  assert.equal(decision.materialize, false);
});

test('no players leaves disposable population cold and eligible for retirement', () => {
  const decision = populationInterestAt(0, 0, []);
  assert.equal(decision.distance, Number.POSITIVE_INFINITY);
  assert.equal(decision.tier, 'cold');
  assert.equal(decision.retain, false);
});
