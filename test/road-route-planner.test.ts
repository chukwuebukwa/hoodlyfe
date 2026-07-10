import assert from 'node:assert/strict';
import test from 'node:test';
import {RoadRoutePlanner} from '../server/game/traffic/road-route-planner.ts';
import type {CollisionMap, RoadNode} from '../server/world-map.ts';

test('road planner returns a deterministic shortest route through intersections', () => {
  const graph = createGraph([
    ['0,0', ['1,0', '0,1']],
    ['1,0', ['0,0', '2,0']],
    ['2,0', ['1,0', '2,1']],
    ['0,1', ['0,0', '1,1']],
    ['1,1', ['0,1', '2,1']],
    ['2,1', ['1,1', '2,0']]
  ]);
  const planner = new RoadRoutePlanner(graph);

  const plan = planner.plan({column: 0, row: 0}, {column: 2, row: 1});

  assert.equal(plan.complete, true);
  assert.deepEqual(plan.nodes, [
    {column: 0, row: 0},
    {column: 1, row: 0},
    {column: 2, row: 0},
    {column: 2, row: 1}
  ]);
  assert.ok(plan.visited <= 6);
});

test('road planner returns bounded partial progress when its work budget is exhausted', () => {
  const graph = createGraph([
    ['0,0', ['1,0']],
    ['1,0', ['0,0', '2,0']],
    ['2,0', ['1,0', '3,0']],
    ['3,0', ['2,0', '4,0']],
    ['4,0', ['3,0']]
  ]);
  const planner = new RoadRoutePlanner(graph, 2);

  const plan = planner.plan({column: 0, row: 0}, {column: 4, row: 0});

  assert.equal(plan.complete, false);
  assert.equal(plan.visited, 2);
  assert.deepEqual(plan.nodes, [{column: 0, row: 0}, {column: 1, row: 0}]);
});

function createGraph(entries: Array<[string, string[]]>): Pick<CollisionMap, 'roadNeighbors'> {
  const graph = new Map(entries);
  return {
    roadNeighbors(column: number, row: number): RoadNode[] {
      return (graph.get(`${column},${row}`) ?? []).map((key) => {
        const [nextColumn, nextRow] = key.split(',').map(Number);
        return {column: nextColumn, row: nextRow};
      });
    }
  };
}
