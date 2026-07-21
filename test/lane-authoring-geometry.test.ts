import assert from 'node:assert/strict';
import test from 'node:test';
import {
  corridorIntersections,
  nearestCorridorIntersection,
  repairJunctionIntersections,
  synchronizeJunctionIntersections
} from '../src/tools/level-editor/lane-authoring-geometry.ts';

test('junction authoring snaps to the nearest exact corridor intersection', () => {
  const result = nearestCorridorIntersection([
    {id: 'horizontal', speedLimit: 80, points: [{x: 0, y: 50}, {x: 100, y: 50}]},
    {id: 'vertical', speedLimit: 80, points: [{x: 60, y: 0}, {x: 60, y: 100}]}
  ], {x: 57, y: 54}, 20);

  assert.deepEqual(result?.point, {x: 60, y: 50});
  assert.deepEqual(result?.corridorIds, ['horizontal', 'vertical']);
});

test('junction authoring refuses clicks without a nearby corridor intersection', () => {
  const result = nearestCorridorIntersection([
    {id: 'horizontal', speedLimit: 80, points: [{x: 0, y: 50}, {x: 100, y: 50}]},
    {id: 'vertical', speedLimit: 80, points: [{x: 60, y: 0}, {x: 60, y: 100}]}
  ], {x: 10, y: 10}, 10);

  assert.equal(result, undefined);
});

test('junction repair follows a corridor endpoint edit to the new shared intersection', () => {
  const result = repairJunctionIntersections([
    {id: 'horizontal', speedLimit: 80, points: [{x: 0, y: 40}, {x: 100, y: 50}]},
    {id: 'vertical', speedLimit: 80, points: [{x: 60, y: 0}, {x: 60, y: 100}]}
  ], [{id: 'junction', x: 60, y: 50, corridors: ['horizontal', 'vertical']}]);

  assert.equal(result.repaired, 1);
  assert.equal(result.removed, 0);
  assert.equal(result.unresolved, 0);
  assert.ok(Math.abs(result.junctions[0].y - 46) < 0.0001);
});

test('junction repair removes stale records with fewer than two live corridors', () => {
  const result = repairJunctionIntersections([
    {id: 'remaining', speedLimit: 80, points: [{x: 0, y: 50}, {x: 100, y: 50}]}
  ], [
    {id: 'orphan', x: 60, y: 50, corridors: ['remaining']},
    {id: 'missing-reference', x: 40, y: 50, corridors: ['remaining', 'deleted']}
  ]);

  assert.deepEqual(result.junctions, []);
  assert.equal(result.repaired, 0);
  assert.equal(result.removed, 2);
  assert.equal(result.unresolved, 0);
});

test('corridor intersections expose every exact valid junction placement', () => {
  const intersections = corridorIntersections([
    {id: 'horizontal', speedLimit: 80, points: [{x: 0, y: 50}, {x: 100, y: 50}]},
    {id: 'vertical-a', speedLimit: 80, points: [{x: 25, y: 0}, {x: 25, y: 100}]},
    {id: 'vertical-b', speedLimit: 80, points: [{x: 75, y: 0}, {x: 75, y: 100}]}
  ]);

  assert.deepEqual(intersections.map(({point, corridorIds}) => ({point, corridorIds})), [
    {point: {x: 25, y: 50}, corridorIds: ['horizontal', 'vertical-a']},
    {point: {x: 75, y: 50}, corridorIds: ['horizontal', 'vertical-b']}
  ]);
});

test('junction synchronization creates missing crossings and preserves valid junction settings', () => {
  const corridors = [
    {id: 'horizontal', speedLimit: 80, points: [{x: 0, y: 50}, {x: 100, y: 50}]},
    {id: 'vertical-a', speedLimit: 80, points: [{x: 25, y: 0}, {x: 25, y: 100}]},
    {id: 'vertical-b', speedLimit: 80, points: [{x: 75, y: 0}, {x: 75, y: 100}]}
  ];
  const result = synchronizeJunctionIntersections(corridors, [{
    id: 'configured', x: 25, y: 50, corridors: ['horizontal', 'vertical-a'], allowedTurns: ['right']
  }]);

  assert.equal(result.added, 1);
  assert.equal(result.removed, 0);
  assert.equal(result.junctions.length, 2);
  assert.deepEqual(result.junctions.find(({id}) => id === 'configured')?.allowedTurns, ['right']);
  assert.deepEqual(result.junctions.find(({id}) => id !== 'configured')?.corridors, ['horizontal', 'vertical-b']);
});
