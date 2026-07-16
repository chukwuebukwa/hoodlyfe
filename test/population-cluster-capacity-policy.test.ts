import assert from 'node:assert/strict';
import test from 'node:test';
import {
  fairPopulationCandidateOrder,
  populationClusterCapacityPlan
} from '../server/game/population/population-cluster-capacity-policy.ts';
import type {PopulationInterestCluster} from '../server/game/population/population-interest-cluster-policy.ts';

const clusters: PopulationInterestCluster[] = [
  {id: 'cluster:a', memberIds: ['a'], anchors: [{x: 0, y: 0}]},
  {id: 'cluster:b', memberIds: ['b'], anchors: [{x: 8_000, y: 0}]}
];

test('capacity planning reports deterministic entitlement pressure and required relief', () => {
  const plan = populationClusterCapacityPlan(
    clusters,
    4,
    new Map([['cluster:a', 4], ['cluster:b', 0]]),
    new Map([['cluster:b', 3]])
  );

  assert.deepEqual([...plan.quotaByCluster], [['cluster:a', 2], ['cluster:b', 2]]);
  assert.deepEqual([...plan.pressuredClusterIds], ['cluster:b']);
  assert.equal(plan.reliefNeeded, 2);
});

test('free global slots satisfy entitlement demand without unnecessary relief', () => {
  const plan = populationClusterCapacityPlan(
    clusters,
    4,
    new Map([['cluster:a', 2]]),
    new Map([['cluster:b', 2]])
  );

  assert.equal(plan.reliefNeeded, 0);
  assert.deepEqual([...plan.pressuredClusterIds], ['cluster:b']);
});

test('candidate ordering serves equal entitlements before lending idle capacity', () => {
  const order = fairPopulationCandidateOrder(
    clusters,
    4,
    new Map(),
    [
      {id: 'a1', clusterId: 'cluster:a'},
      {id: 'a2', clusterId: 'cluster:a'},
      {id: 'a3', clusterId: 'cluster:a'},
      {id: 'b1', clusterId: 'cluster:b'}
    ]
  );

  assert.deepEqual(order.map((candidate) => candidate.id), ['a1', 'b1', 'a2', 'a3']);
});

test('candidate ordering remains stable when every component has surplus demand', () => {
  const order = fairPopulationCandidateOrder(
    [...clusters].reverse(),
    4,
    new Map(),
    [
      {id: 'b1', clusterId: 'cluster:b'},
      {id: 'a1', clusterId: 'cluster:a'},
      {id: 'b2', clusterId: 'cluster:b'},
      {id: 'a2', clusterId: 'cluster:a'},
      {id: 'b3', clusterId: 'cluster:b'},
      {id: 'a3', clusterId: 'cluster:a'}
    ]
  );

  assert.deepEqual(order.map((candidate) => candidate.id), [
    'a1', 'b1', 'a2', 'b2', 'a3', 'b3'
  ]);
});
