import assert from 'node:assert/strict';
import test from 'node:test';
import {districtPoint} from '../shared/content/district-map-frame.ts';
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
  const centralPoint = districtPoint(2336, 2656);
  assert.deepEqual(central && {id: central.id, x: central.x, y: central.y}, {
    id: 'central-center', ...centralPoint
  });
  assert.ok((graph.junction('west-north-service')?.conflictRadius ?? 0) > 90);
  assert.equal(graph.junctions().length, 32);
  assert.equal(graph.schemaVersion, 2);
  assert.equal(graph.districtId, 'industrial-district');
  assert.equal(graph.nodes().length, 138);
  assert.equal(graph.edges().length, 220);
  assert.deepEqual(graph.roadblocks().map((roadblock) => roadblock.id), [
    'north-boulevard-east',
    'central-avenue-mid',
    'south-boulevard-east'
  ]);
  assert.ok(graph.roadblocks().every((roadblock) => (
    roadblock.blockedEdgeIds.every((edgeId) => Boolean(graph.edge(edgeId))) &&
    roadblock.vehiclePoses.every((pose) => world.canOccupy(pose.x, pose.y, 20))
  )));
  assert.ok(graph.edges().some((edge) => edge.kind === 'connector' && edge.turn === 'left'));
  assert.ok(graph.edges().some((edge) => edge.kind === 'connector' && edge.turn === 'right'));
  assert.ok(graph.edges().some((edge) => (
    edge.kind === 'turnaround' && edge.junctionId === 'terminal:west-avenue:end'
  )));
  assert.equal(graph.nodes().filter((node) => node.corridorId === 'south-boulevard-north').length, 8);
  assert.equal(graph.nodes().filter((node) => node.corridorId === 'south-boulevard-south').length, 8);
  assert.ok(graph.nodes().filter((node) => node.corridorId === 'south-boulevard-north').every((node) => node.direction === 'reverse'));
  assert.ok(graph.nodes().filter((node) => node.corridorId === 'south-boulevard-south').every((node) => node.direction === 'forward'));
  assert.ok(graph.edges().some((edge) => edge.kind === 'connector' && edge.junctionId === 'south-boulevard-east-north-return'));
  assert.ok(graph.edges().some((edge) => edge.kind === 'connector' && edge.junctionId === 'south-boulevard-west-south-return'));
  assert.ok(graph.nodes().every((node) => graph.outgoing(node.id).length > 0));
  assert.ok(graph.nodes().every((node) => Boolean(node.surfaceId)));
  assert.ok(graph.edges().every((edge) => Boolean(edge.fromSurfaceId && edge.toSurfaceId)));

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
    assert.equal(world.canOccupy(spawn.x, spawn.y, 20, spawn.surfaceId, 'vehicle'), true);
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
  const centerX = districtPoint(2336, 0).x;
  assert.ok(southbound.x < centerX);
  assert.ok(outerSouthbound.x < southbound.x);
  assert.ok(northbound.x > centerX);
  assert.ok(outerNorthbound.x > northbound.x);
});

test('legacy corridors still compile both directions', () => {
  const graph = LaneGraph.fromDocument({
    schemaVersion: 2,
    districtId: 'legacy-two-way',
    driveSide: 'right',
    laneOffset: 4,
    laneSpacing: 7,
    allowTerminalTurnarounds: true,
    corridors: [{id: 'main', speedLimit: 80, points: [{x: 0, y: 0}, {x: 100, y: 0}]}],
    junctions: []
  }, openLaneWorld());

  assert.ok(graph.edges().some((edge) => edge.id.startsWith('main:forward:')));
  assert.ok(graph.edges().some((edge) => edge.id.startsWith('main:reverse:')));
});

test('one-way corridors compile only their configured direction and valid junction movements', () => {
  const forward = LaneGraph.fromDocument(oneWayLoopDocument('forward'), openLaneWorld());
  assert.ok(forward.edges().some((edge) => edge.id.startsWith('north:forward:')));
  assert.equal(forward.edges().some((edge) => edge.id.includes(':reverse:')), false);
  assertDirectionalConnectors(forward, 'forward');

  const reverse = LaneGraph.fromDocument(oneWayLoopDocument('reverse'), openLaneWorld());
  assert.ok(reverse.edges().some((edge) => edge.id.startsWith('north:reverse:')));
  assert.equal(reverse.edges().some((edge) => edge.id.includes(':forward:')), false);
  assertDirectionalConnectors(reverse, 'reverse');
});

test('one-way networks remain strongly connected through authored return routes', () => {
  const graph = LaneGraph.fromDocument(oneWayLoopDocument('forward'), openLaneWorld());
  const planner = new TrafficRoutePlanner(graph);
  const origin = graph.nodes()[0].id;
  for (const node of graph.nodes()) {
    assert.equal(planner.plan(origin, node.id).complete, true, `Expected route to ${node.id}.`);
    assert.equal(planner.plan(node.id, origin).complete, true, `Expected return route from ${node.id}.`);
  }
});

test('roadblocks cannot reference lane directions omitted by a corridor', () => {
  const document = oneWayLoopDocument('forward');
  document.roadblocks = [{
    id: 'invalid-reverse-closure',
    x: 50,
    y: 0,
    angle: 0,
    blockedEdgeIds: ['north:reverse:edge:0'],
    vehiclePoses: [{x: 45, y: 0, angle: 0}],
    stinger: {x: 50, y: 0, angle: 0, officerPose: {x: 50, y: 10, angle: 0}}
  }];
  assert.throws(
    () => LaneGraph.fromDocument(document, openLaneWorld()),
    (error: unknown) => error instanceof LaneGraphValidationError &&
      error.issues.some((issue) => issue.includes('unknown edge north:reverse:edge:0'))
  );
});

test('lane route planner crosses corridors deterministically without violating direction', () => {
  const graph = LaneGraph.load(CollisionMap.load());
  const planner = new TrafficRoutePlanner(graph);
  const first = planner.plan(
    'north-service-road:forward:0',
    'south-boulevard-south:forward:0'
  );
  const second = planner.plan(
    'north-service-road:forward:0',
    'south-boulevard-south:forward:0'
  );

  assert.deepEqual(first, second);
  assert.equal(first.complete, true);
  assert.equal(first.nodeIds[0], 'north-service-road:forward:0');
  assert.equal(first.nodeIds.at(-1), 'south-boulevard-south:forward:0');
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
    'south-boulevard-south:forward:0'
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

test('lane spawning, advancement, and planning honor dynamic edge closures', () => {
  const graph = LaneGraph.load(CollisionMap.load());
  const blocked = new Set(graph.roadblocks().flatMap((roadblock) => roadblock.blockedEdgeIds));
  const edgeAllowed = (edge: {id: string}) => !blocked.has(edge.id);

  for (let index = 0; index < 60; index++) {
    const spawn = graph.spawn(index * 79, 20, edgeAllowed);
    assert.ok(spawn);
    assert.equal(blocked.has(spawn.laneEdgeId ?? ''), false);
    const next = graph.advance(spawn, index * 41, edgeAllowed);
    if (next) assert.equal(blocked.has(next.laneEdgeId ?? ''), false);
  }

  const closed = graph.roadblocks().find((roadblock) => roadblock.id === 'central-avenue-mid')!;
  const directEdge = graph.edge(closed.blockedEdgeIds[0])!;
  const plan = new TrafficRoutePlanner(graph, 512, edgeAllowed).plan(
    directEdge.fromNodeId,
    directEdge.toNodeId
  );
  assert.equal(plan.complete, true);
  assert.ok(plan.edgeIds.length > 1, 'the closure should force a detour');
  assert.equal(plan.edgeIds.some((edgeId) => blocked.has(edgeId)), false);
});

function openLaneWorld() {
  return {
    tileWidth: 64,
    tileHeight: 64,
    isRoadAt: () => true,
    canOccupy: () => true
  };
}

function oneWayLoopDocument(direction: 'forward' | 'reverse'): LaneGraphDocument {
  return {
    schemaVersion: 2,
    districtId: `one-way-${direction}`,
    driveSide: 'right',
    laneOffset: 4,
    laneSpacing: 7,
    allowTerminalTurnarounds: true,
    corridors: [
      {id: 'north', speedLimit: 80, direction, points: [{x: 0, y: 0}, {x: 100, y: 0}]},
      {id: 'east', speedLimit: 80, direction, points: [{x: 100, y: 0}, {x: 100, y: 100}]},
      {id: 'south', speedLimit: 80, direction, points: [{x: 100, y: 100}, {x: 0, y: 100}]},
      {id: 'west', speedLimit: 80, direction, points: [{x: 0, y: 100}, {x: 0, y: 0}]}
    ],
    junctions: [
      {id: 'north-east', x: 100, y: 0, corridors: ['north', 'east']},
      {id: 'south-east', x: 100, y: 100, corridors: ['east', 'south']},
      {id: 'south-west', x: 0, y: 100, corridors: ['south', 'west']},
      {id: 'north-west', x: 0, y: 0, corridors: ['west', 'north']}
    ]
  };
}

function assertDirectionalConnectors(graph: LaneGraph, direction: 'forward' | 'reverse'): void {
  const connectors = graph.edges().filter((edge) => edge.kind === 'connector');
  assert.ok(connectors.length > 0);
  for (const edge of connectors) {
    assert.equal(graph.node(edge.fromNodeId)?.direction, direction);
    assert.equal(graph.node(edge.toNodeId)?.direction, direction);
  }
}
