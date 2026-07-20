import assert from 'node:assert/strict';
import test from 'node:test';
import {
  nearestCorridorIntersection,
  repairJunctionIntersections
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
  assert.equal(result.unresolved, 0);
  assert.ok(Math.abs(result.junctions[0].y - 46) < 0.0001);
});
