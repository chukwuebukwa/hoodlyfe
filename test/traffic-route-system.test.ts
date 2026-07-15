import assert from 'node:assert/strict';
import test from 'node:test';
import {LaneGraph} from '../server/game/traffic/lane-graph.ts';
import {TrafficRouteSystem} from '../server/game/traffic/traffic-route-system.ts';
import {DeterministicRandom} from '../server/game/world/deterministic-random.ts';
import {CollisionMap} from '../server/world-map.ts';

test('traffic route system owns a durable authored route and advances it deterministically', () => {
  const world = CollisionMap.load();
  const graph = LaneGraph.load(world);
  const routes = new TrafficRouteSystem({
    world,
    laneGraph: graph,
    random: new DeterministicRandom('route-system')
  });
  const spawn = routes.spawn(41, 20);
  const runtime = routes.create('traffic-41', spawn);
  const initial = routes.diagnostic(runtime);

  assert.equal(runtime.source, 'lane-graph');
  assert.equal(initial.routeRevision, 1);
  assert.equal(initial.routeComplete, true);
  assert.ok(initial.routeRemaining >= 2);
  assert.equal(initial.routeWaypoints.length, initial.routeRemaining);

  const expectedFirstTarget = graph.node(runtime.nodeIds[0]);
  assert.ok(expectedFirstTarget);
  assert.deepEqual(routes.target(runtime), {x: expectedFirstTarget.x, y: expectedFirstTarget.y});

  routes.advance('traffic-41', runtime, 50);
  const advanced = routes.diagnostic(runtime);
  assert.equal(advanced.routeRevision, initial.routeRevision);
  assert.equal(advanced.routeRemaining, initial.routeRemaining - 1);

  while (runtime.revision === initial.routeRevision) {
    routes.advance('traffic-41', runtime, 1000 + runtime.nodeIndex * 50);
  }
  const replanned = routes.diagnostic(runtime);
  assert.equal(replanned.routeRevision, initial.routeRevision + 1);
  assert.equal(replanned.routeComplete, true);
  assert.ok(replanned.routeRemaining > 0);
});

test('traffic route recovery reprojects authority onto a legal lane and replans once', () => {
  const world = CollisionMap.load();
  const graph = LaneGraph.load(world);
  const routes = new TrafficRouteSystem({
    world,
    laneGraph: graph,
    random: new DeterministicRandom('route-recovery')
  });
  const spawn = routes.spawn(19, 20);
  const runtime = routes.create('traffic-recovery', spawn);
  const previousRevision = runtime.revision;
  const recovered = routes.recover({
    id: 'traffic-recovery',
    x: spawn.x,
    y: spawn.y,
    angle: spawn.angle
  }, runtime, 991);

  assert.equal(recovered, true);
  assert.equal(runtime.source, 'lane-graph');
  assert.equal(runtime.revision, previousRevision + 1);
  assert.ok(graph.node(runtime.currentLaneNodeId));
  assert.ok(runtime.nodeIds.length >= 2);
  assert.ok(runtime.nodeIds.every((nodeId) => Boolean(graph.node(nodeId))));
});

test('traffic route system preserves the road-cell fallback when no authored graph is supplied', () => {
  const world = CollisionMap.load();
  const routes = new TrafficRouteSystem({
    world,
    random: new DeterministicRandom('route-fallback')
  });
  const spawn = world.trafficSpawn(7, 20);
  const runtime = routes.create('legacy-traffic', spawn);
  const originalTarget = {column: runtime.targetColumn, row: runtime.targetRow};

  assert.equal(runtime.source, 'road-cell-fallback');
  assert.equal(runtime.revision, 0);
  assert.deepEqual(routes.diagnostic(runtime).routeWaypoints, []);

  routes.advance('legacy-traffic', runtime, 500);
  assert.deepEqual(
    {column: runtime.previousColumn, row: runtime.previousRow},
    originalTarget
  );

  const virtual = routes.advanceVirtual(spawn, 123);
  assert.equal(world.isRoadAt(virtual.x, virtual.y), true);
  const captured = routes.captureVirtual({x: virtual.x, y: virtual.y, angle: virtual.angle});
  assert.equal(world.isRoadAt(captured.x, captured.y), true);
});
