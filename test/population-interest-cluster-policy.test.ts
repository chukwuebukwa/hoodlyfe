import assert from 'node:assert/strict';
import test from 'node:test';
import {
  POPULATION_INTEREST_CLUSTERING,
  nearestPopulationInterestCluster,
  populationInterestClusterQuotas,
  populationInterestClusters
} from '../server/game/population/population-interest-cluster-policy.ts';
import type {PopulationInterestAnchor} from '../server/game/population/population-activation-policy.ts';

test('overlapping player retention envelopes form deterministic interest components', () => {
  const anchors: PopulationInterestAnchor[] = [
    {x: 8_000, y: 0, kind: 'player', protectsVisibility: true, ownerId: 'far'},
    {x: 400, y: 0, kind: 'player', protectsVisibility: true, ownerId: 'near-b'},
    {x: 0, y: 0, kind: 'player', protectsVisibility: true, ownerId: 'near-a'},
    {x: 8_480, y: 0, kind: 'lookahead', protectsVisibility: false, ownerId: 'far'}
  ];
  const forward = populationInterestClusters(anchors);
  const reversed = populationInterestClusters([...anchors].reverse());

  assert.deepEqual(forward, reversed);
  assert.equal(forward.length, 2);
  assert.deepEqual(forward.map((cluster) => cluster.memberIds), [
    ['far'],
    ['near-a', 'near-b']
  ]);
  assert.equal(forward[0].anchors.filter((anchor) => anchor.kind === 'lookahead').length, 1);
});

test('lookahead cannot create a standalone population component', () => {
  assert.deepEqual(populationInterestClusters([{
    x: 10_000,
    y: 0,
    kind: 'lookahead',
    protectsVisibility: false,
    ownerId: 'missing-player'
  }]), []);
});

test('cluster linkage follows overlapping retention envelopes at the exact boundary', () => {
  const linked = populationInterestClusters([
    {x: 0, y: 0, ownerId: 'a'},
    {x: POPULATION_INTEREST_CLUSTERING.linkRadius, y: 0, ownerId: 'b'}
  ]);
  const split = populationInterestClusters([
    {x: 0, y: 0, ownerId: 'a'},
    {x: POPULATION_INTEREST_CLUSTERING.linkRadius + 0.01, y: 0, ownerId: 'b'}
  ]);
  assert.equal(linked.length, 1);
  assert.equal(split.length, 2);
});

test('capacity is divided equally with stable remainder ownership', () => {
  const clusters = populationInterestClusters([
    {x: 8_000, y: 0, ownerId: 'c'},
    {x: 0, y: 0, ownerId: 'a'},
    {x: 4_000, y: 0, ownerId: 'b'}
  ]);
  assert.deepEqual(
    populationInterestClusterQuotas(clusters, 8).map(({cluster, quota}) => [cluster.memberIds[0], quota]),
    [['a', 3], ['b', 3], ['c', 2]]
  );
  assert.throws(() => populationInterestClusterQuotas(clusters, 1.5), /non-negative integer/);
});

test('nearest cluster uses distance then stable cluster identity', () => {
  const clusters = populationInterestClusters([
    {x: 0, y: 0, ownerId: 'a'},
    {x: 8_000, y: 0, ownerId: 'b'}
  ]);
  assert.deepEqual(nearestPopulationInterestCluster(4_000, 0, clusters), {
    cluster: clusters[0],
    distance: 4_000
  });
  assert.equal(nearestPopulationInterestCluster(Number.NaN, 0, clusters), undefined);
});
