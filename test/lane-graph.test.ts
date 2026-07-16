import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LaneGraph,
  LaneGraphValidationError,
  type LaneGraphDocument
} from '../server/game/traffic/lane-graph.ts';
import {TrafficRoutePlanner} from '../server/game/traffic/traffic-route-planner.ts';
import {CollisionMap} from '../server/world-map.ts';

test('authored district lane graph is valid, connected, directed, and spawnable', () => {
  const world = CollisionMap.load();
  const graph = LaneGraph.load(world);

  const central = graph.junction('central-center');
  assert.deepEqual(central && {id: central.id, x: central.x, y: central.y}, {
    id: 'central-center', x: 2336, y: 2656
  });
  assert.ok((graph.junction('west-north-service')?.conflictRadius ?? 0) > 90);
  assert.equal(graph.junctions().length, 32);
  assert.equal(graph.schemaVersion, 2);
  assert.equal(graph.districtId, 'industrial-district');
  assert.equal(graph.nodes().length, 150);
  assert.equal(graph.edges().length, 246);
  assert.ok(graph.edges().some((edge) => edge.kind === 'connector' && edge.turn === 'left'));
  assert.ok(graph.edges().some((edge) => edge.kind === 'connector' && edge.turn === 'right'));
  assert.ok(graph.edges().some((edge) => (
    edge.kind === 'turnaround' && edge.junctionId === 'terminal:west-avenue:end'
  )));
  assert.ok(graph.nodes().every((node) => graph.outgoing(node.id).length > 0));

  const multiLaneEdge = graph.edge('central-avenue:forward:edge:2');
  assert.ok(multiLaneEdge);
  const adjacent = graph.adjacentLaneEdges(multiLaneEdge.id);
  assert.equal(adjacent.length, 1);
  assert.equal(graph.node(adjacent[0].fromNodeId)?.laneIndex, 1);
  assert.equal(graph.node(adjacent[0].fromNodeId)?.direction, 'forward');
  assert.equal(graph.node(adjacent[0].fromNodeId)?.corridorId, 'central-avenue');

  const planner = new TrafficRoutePlanner(graph);
  const origin = graph.nodes()[0].id;
  for (const node of graph.nodes()) {
    assert.equal(planner.plan(origin, node.id).complete, true, `Expected route to ${node.id}.`);
    assert.equal(planner.plan(node.id, origin).complete, true, `Expected return route from ${node.id}.`);
  }

  for (let index = 0; index < 80; index++) {
    const spawn = graph.spawn(index * 193, 20);
    assert.ok(spawn, `Expected a lane spawn for index ${index}.`);
    assert.ok(spawn.laneEdgeId);
    assert.ok(spawn.laneFromNodeId);
    assert.ok(spawn.laneToNodeId);
    assert.equal(world.isRoadAt(spawn.x, spawn.y), true);
    assert.equal(world.canOccupy(spawn.x, spawn.y, 20), true);
  }
});

test('right-hand lane compilation offsets opposing directions to opposite sides', () => {
  const graph = LaneGraph.load(CollisionMap.load());
  const southbound = graph.node('central-avenue:forward:2');
  const outerSouthbound = graph.node('central-avenue:forward:lane-1:2');
  const northbound = graph.node('central-avenue:reverse:5');
  const outerNorthbound = graph.node('central-avenue:reverse:lane-1:5');
  assert.ok(southbound);
  assert.ok(outerSouthbound);
  assert.ok(northbound);
  assert.ok(outerNorthbound);
  assert.equal(southbound.y, northbound.y);
  assert.ok(southbound.x < 2336);
  assert.ok(outerSouthbound.x < southbound.x);
  assert.ok(northbound.x > 2336);
  assert.ok(outerNorthbound.x > northbound.x);
});

test('lane route planner crosses corridors deterministically without violating direction', () => {
  const graph = LaneGraph.load(CollisionMap.load());
  const planner = new TrafficRoutePlanner(graph);
  const first = planner.plan(
    'north-service-road:forward:0',
    'south-boulevard-south:reverse:3'
  );
  const second = planner.plan(
    'north-service-road:forward:0',
    'south-boulevard-south:reverse:3'
  );

  assert.deepEqual(first, second);
  assert.equal(first.complete, true);
  assert.equal(first.nodeIds[0], 'north-service-road:forward:0');
  assert.equal(first.nodeIds.at(-1), 'south-boulevard-south:reverse:3');
  assert.equal(first.edgeIds.length, first.nodeIds.length - 1);
  assert.ok(first.edgeIds.some((edgeId) => graph.edge(edgeId)?.kind === 'connector'));
  for (let index = 0; index < first.edgeIds.length; index++) {
    const edge = graph.edge(first.edgeIds[index]);
    assert.ok(edge);
    assert.equal(edge.fromNodeId, first.nodeIds[index]);
    assert.equal(edge.toNodeId, first.nodeIds[index + 1]);
  }
});

test('bounded lane planning returns explicit partial work rather than hiding failure', () => {
  const graph = LaneGraph.load(CollisionMap.load());
  const plan = new TrafficRoutePlanner(graph, 2).plan(
    'north-service-road:forward:0',
    'south-boulevard-south:reverse:3'
  );

  assert.equal(plan.complete, false);
  assert.equal(plan.visited, 2);
  assert.ok(plan.nodeIds.length >= 1);
  assert.equal(plan.edgeIds.length, plan.nodeIds.length - 1);
});

test('lane graph rejects invalid junction ownership and blocked geometry', () => {
  const document: LaneGraphDocument = {
    schemaVersion: 2,
    districtId: 'test',
    driveSide: 'right',
    laneOffset: 4,
    laneSpacing: 7,
    allowTerminalTurnarounds: true,
    corridors: [
      {id: 'horizontal', speedLimit: 80, points: [{x: 0, y: 0}, {x: 100, y: 0}]},
      {id: 'vertical', speedLimit: 80, points: [{x: 50, y: -50}, {x: 50, y: 50}]}
    ],
    junctions: [{
      id: 'invalid',
      x: 60,
      y: 10,
      corridors: ['horizontal', 'vertical']
    }]
  };
  const openWorld = {
    tileWidth: 64,
    tileHeight: 64,
    isRoadAt: () => true,
    canOccupy: () => true
  };
  assert.throws(
    () => LaneGraph.fromDocument(document, openWorld),
    (error: unknown) => error instanceof LaneGraphValidationError &&
      error.issues.some((issue) => issue.includes('does not lie on corridor'))
  );

  const validDocument = structuredClone(document);
  validDocument.junctions[0].x = 50;
  validDocument.junctions[0].y = 0;
  assert.throws(
    () => LaneGraph.fromDocument(validDocument, {...openWorld, canOccupy: () => false}),
    (error: unknown) => error instanceof LaneGraphValidationError &&
      error.issues.some((issue) => issue.includes('blocked for a vehicle'))
  );
});

test('virtual lane advancement preserves legal directed edge ownership', () => {
  const graph = LaneGraph.load(CollisionMap.load());
  const start = graph.spawn(77, 20);
  assert.ok(start);
  const next = graph.advance(start, 91);
  assert.ok(next);
  const currentEdge = graph.edge(start.laneEdgeId!);
  const nextEdge = graph.edge(next.laneEdgeId!);
  assert.ok(currentEdge);
  assert.ok(nextEdge);
  assert.equal(currentEdge.toNodeId, nextEdge.fromNodeId);
});
