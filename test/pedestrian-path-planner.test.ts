import assert from 'node:assert/strict';
import test from 'node:test';
import {PedestrianNavigationSystem} from '../server/game/pedestrians/pedestrian-navigation-system.ts';
import {PedestrianPathPlanner} from '../server/game/pedestrians/pedestrian-path-planner.ts';
import {createPedestrianRuntime} from '../server/game/pedestrians/pedestrian-runtime.ts';
import {DeterministicRandom} from '../server/game/world/deterministic-random.ts';
import {NpcState} from '../server/state.ts';
import {CollisionMap} from '../server/world-map.ts';

test('bounded pedestrian paths deterministically route around blocked structures', () => {
  const world = corridorWorld();
  const start = {x: 24, y: 40};
  const goal = {x: 120, y: 40};
  const first = new PedestrianPathPlanner(world).plan(start, goal, 4);
  const second = new PedestrianPathPlanner(world).plan(start, goal, 4);

  assert.ok(first);
  assert.deepEqual(first, second);
  assert.equal(first.complete, true);
  assert.ok(first.expandedNodes > 0 && first.expandedNodes <= 384);
  assert.ok(first.points.some((point) => point.y >= 88));
  let previous = start;
  const planner = new PedestrianPathPlanner(world);
  for (const point of first.points) {
    assert.equal(planner.pathIsClear(previous, point, 4), true);
    previous = point;
  }
});

test('path expansion and per-tick request budgets remain explicit', () => {
  const world = corridorWorld();
  assert.equal(
    new PedestrianPathPlanner(world, 2).plan({x: 24, y: 40}, {x: 120, y: 40}, 4),
    undefined
  );

  let tick = 10;
  const navigation = new PedestrianNavigationSystem({
    random: new DeterministicRandom('path-budget'),
    clock: () => ({tick}),
    world,
    radius: 4,
    maxPathRequestsPerTick: 1
  });
  const firstNpc = npc('first');
  const secondNpc = npc('second');
  const firstRuntime = createPedestrianRuntime(0);
  const secondRuntime = createPedestrianRuntime(0);
  const intent = {
    objective: 'investigate' as const,
    angle: 0,
    speed: 58,
    fire: false,
    aimAngle: 0,
    targetX: 120,
    targetY: 40
  };

  const firstAngle = navigation.resolveAngle(firstNpc, firstRuntime, intent, 1000);
  navigation.resolveAngle(secondNpc, secondRuntime, intent, 1000);
  assert.notEqual(firstAngle, 0);
  assert.ok(firstRuntime.navigation.waypoints.length > 0);
  assert.equal(secondRuntime.navigation.waypoints.length, 0);

  tick++;
  navigation.resolveAngle(secondNpc, secondRuntime, intent, 1033);
  assert.ok(secondRuntime.navigation.waypoints.length > 0);
});

function corridorWorld(): CollisionMap {
  const width = 9;
  const height = 7;
  const collisions = new Array(width * height).fill(0);
  for (let row = 0; row <= 4; row++) collisions[row * width + 4] = 1;
  return new CollisionMap({
    width,
    height,
    tilewidth: 16,
    tileheight: 16,
    layers: [{name: 'collisions', data: collisions}]
  }, {spawn: {x: 24, y: 40}});
}

function npc(id: string): NpcState {
  const value = new NpcState();
  value.id = id;
  value.x = 24;
  value.y = 40;
  return value;
}
