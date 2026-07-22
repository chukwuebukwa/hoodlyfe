import assert from 'node:assert/strict';
import test from 'node:test';
import {TrafficController, trafficLanePoint} from '../server/game/traffic/traffic-controller.ts';
import {LaneGraph} from '../server/game/traffic/lane-graph.ts';
import {DeterministicRandom} from '../server/game/world/deterministic-random.ts';
import {VehicleState} from '../server/state.ts';
import {CollisionMap} from '../server/world-map.ts';
import {VEHICLE_KINDS, vehicleDefinition} from '../shared/content/vehicle-catalog.ts';

test('traffic controller follows deterministic road routes and releases hijacked cars', () => {
  const world = CollisionMap.load();
  const first = createTraffic(world, 'traffic-a', 211);
  const second = createTraffic(world, 'traffic-a', 211);
  const firstController = new TrafficController({
    world,
    random: new DeterministicRandom('traffic-scenario')
  });
  const secondController = new TrafficController({
    world,
    random: new DeterministicRandom('traffic-scenario')
  });
  firstController.register(first.vehicle.id, first.spawn, 118);
  secondController.register(second.vehicle.id, second.spawn, 118);

  for (let tick = 1; tick <= 120; tick++) {
    firstController.update(first.vehicle, 1 / 30, tick * 1000 / 30);
    secondController.update(second.vehicle, 1 / 30, tick * 1000 / 30);
  }
  assert.ok(Math.hypot(first.vehicle.x - first.spawn.x, first.vehicle.y - first.spawn.y) > 20);
  assert.equal(first.vehicle.x, second.vehicle.x);
  assert.equal(first.vehicle.y, second.vehicle.y);
  assert.equal(first.vehicle.angle, second.vehicle.angle);

  first.vehicle.hijackBy = 'player';
  const speedBeforeBraking = first.vehicle.speed;
  firstController.update(first.vehicle, 1 / 30, 5000);
  assert.ok(first.vehicle.speed < speedBeforeBraking);
  firstController.release(first.vehicle.id);
  const released = {x: first.vehicle.x, y: first.vehicle.y, speed: first.vehicle.speed};
  first.vehicle.hijackBy = '';
  firstController.update(first.vehicle, 1, 6000);
  assert.deepEqual({x: first.vehicle.x, y: first.vehicle.y, speed: first.vehicle.speed}, released);
});

test('traffic controller owns a durable authored lane route instead of choosing every tick', () => {
  const world = CollisionMap.load();
  const laneGraph = LaneGraph.load(world);
  const controller = new TrafficController({
    world,
    laneGraph,
    random: new DeterministicRandom('authored-route')
  });
  const spawn = controller.spawn(211, 20);
  const vehicle = new VehicleState();
  vehicle.id = 'authored-traffic';
  vehicle.x = spawn.x;
  vehicle.y = spawn.y;
  vehicle.angle = spawn.angle;
  vehicle.speed = 80;
  vehicle.traffic = true;
  controller.register(vehicle.id, spawn, 118);

  const initial = controller.diagnostics()[0];
  assert.equal(initial.mission, 'cruise-route');
  assert.equal(initial.drivingStyle, 'lawful');
  assert.equal(initial.routeSource, 'lane-graph');
  assert.equal(initial.routeRevision, 1);
  assert.equal(initial.routeComplete, true);
  assert.ok(initial.routeRemaining >= 2);
  assert.equal(initial.routeWaypoints.length, initial.routeRemaining);

  for (let tick = 1; tick <= 30; tick++) {
    controller.update(vehicle, 1 / 30, tick * 1000 / 30);
  }
  const duringEdge = controller.diagnostics()[0];
  assert.equal(duringEdge.routeRevision, 1);
  assert.equal(duringEdge.destinationLaneNodeId, initial.destinationLaneNodeId);
  assert.ok(Math.hypot(vehicle.x - spawn.x, vehicle.y - spawn.y) > 0);

  for (let tick = 31; tick <= 1800; tick++) {
    controller.update(vehicle, 1 / 30, tick * 1000 / 30);
  }
  const circulated = controller.diagnostics()[0];
  assert.ok(circulated.routeRevision >= 1);
  assert.equal(circulated.routeSource, 'lane-graph');
  assert.ok(circulated.currentLaneNodeId);
  assert.ok(circulated.destinationLaneNodeId);
  assert.equal(world.isRoadAt(vehicle.x, vehicle.y), true);
});

test('authored traffic holds junction ownership through crossing and rear clearance', () => {
  const world = CollisionMap.load();
  const laneGraph = LaneGraph.load(world);
  const controller = new TrafficController({
    world,
    laneGraph,
    random: new DeterministicRandom('junction-lifecycle')
  });
  const junction = laneGraph.junctions().find((candidate) => laneGraph.junctionMovements(candidate.id).length > 0)!;
  const movement = laneGraph.junctionMovements(junction.id)[0];
  const entryEdge = laneGraph.edge(movement.entryLaneId)!;
  const entryFrom = laneGraph.node(entryEdge.fromNodeId)!;
  const entryTo = laneGraph.node(entryEdge.toNodeId)!;
  const progress = 0.35;
  const spawn = {
    x: entryFrom.x + (entryTo.x - entryFrom.x) * progress,
    y: entryFrom.y + (entryTo.y - entryFrom.y) * progress,
    angle: Math.atan2(entryTo.y - entryFrom.y, entryTo.x - entryFrom.x),
    column: Math.floor(entryFrom.x / world.tileWidth),
    row: Math.floor(entryFrom.y / world.tileHeight),
    targetColumn: Math.floor(entryTo.x / world.tileWidth),
    targetRow: Math.floor(entryTo.y / world.tileHeight),
    laneEdgeId: entryEdge.id,
    laneFromNodeId: entryEdge.fromNodeId,
    laneToNodeId: entryEdge.toNodeId
  };
  const vehicle = new VehicleState();
  vehicle.id = 'junction-lifecycle';
  vehicle.x = spawn.x;
  vehicle.y = spawn.y;
  vehicle.angle = spawn.angle;
  vehicle.speed = 80;
  vehicle.traffic = true;
  controller.register(vehicle.id, spawn, 118);

  const transitions: string[] = [];
  let previous = 'none';
  for (let tick = 1; tick <= 720; tick++) {
    controller.update(vehicle, 1 / 30, tick * 1000 / 30);
    const phase = controller.diagnostics()[0].junctionPhase;
    if (phase === previous) continue;
    transitions.push(phase);
    previous = phase;
  }

  assert.ok(transitions.includes('approach'));
  assert.ok(transitions.includes('crossing'));
  assert.ok(transitions.includes('clearing'));
  const crossing = transitions.indexOf('crossing');
  assert.deepEqual(transitions.slice(crossing, crossing + 3), ['crossing', 'clearing', 'none']);
});

test('authored traffic waits before reserving a physically occupied conflict zone', () => {
  const world = CollisionMap.load();
  const laneGraph = LaneGraph.load(world);
  const {controller, vehicle, blocker} = occupiedJunctionFixture(world, laneGraph);
  let waitingDiagnostic: ReturnType<TrafficController['diagnostics']>[number] | undefined;
  let waitingTick = 0;
  for (let tick = 2; tick <= 180; tick++) {
    controller.update(vehicle, 1 / 30, tick * 1000 / 30, {obstacles: [blocker]});
    const diagnostic = controller.diagnostics()[0];
    if (diagnostic.junctionPhase === 'waiting') {
      waitingDiagnostic = diagnostic;
      waitingTick = tick;
      break;
    }
  }
  assert.ok(waitingDiagnostic, 'traffic must wait before entering an occupied conflict zone');
  assert.equal(waitingDiagnostic.junctionQueuePosition, 1);
  assert.equal(waitingDiagnostic.junctionLeaseExpiresAt, 0);
  assert.ok(vehicle.speed < 80, 'traffic must brake toward the occupied conflict zone');
  const stopLine = waitingDiagnostic.routeWaypoints[0];
  assert.ok(Math.hypot(vehicle.x - stopLine.x, vehicle.y - stopLine.y) >= 32);

  controller.update(vehicle, 1 / 30, (waitingTick + 1) * 1000 / 30);
  assert.equal(controller.diagnostics()[0].junctionPhase, 'approach');
});

test('traffic controller brakes for an ahead obstacle and exposes its speed reason', () => {
  const world = CollisionMap.load();
  const fixture = createTraffic(world, 'traffic-aware', 211);
  const controller = new TrafficController({
    world,
    random: new DeterministicRandom('traffic-awareness')
  });
  controller.register(fixture.vehicle.id, fixture.spawn, 118);
  const startSpeed = fixture.vehicle.speed;
  controller.update(fixture.vehicle, 1 / 30, 100, {
    obstacles: [{
      id: 'lead',
      kind: 'vehicle',
      x: fixture.vehicle.x + Math.cos(fixture.vehicle.angle) * 60,
      y: fixture.vehicle.y + Math.sin(fixture.vehicle.angle) * 60,
      radius: 20,
      speed: 0,
      angle: fixture.vehicle.angle
    }]
  });
  assert.ok(fixture.vehicle.speed < startSpeed);
  assert.deepEqual(controller.diagnostics().map((entry) => ({
    vehicleId: entry.vehicleId,
    reason: entry.speedReason,
    obstacleId: entry.obstacleId,
    desiredSpeed: entry.desiredSpeed
  })), [{
    vehicleId: 'traffic-aware',
    reason: 'vehicle',
    obstacleId: 'lead',
    desiredSpeed: 0
  }]);

  controller.update(fixture.vehicle, 1 / 30, 200);
  assert.equal(controller.diagnostics()[0].speedReason, 'cruise');
  assert.ok(controller.diagnostics()[0].desiredSpeed > 0);
});

test('authored traffic reserves, executes, and completes a lane change through the controller', () => {
  const world = CollisionMap.load();
  const laneGraph = LaneGraph.load(world);
  const controller = new TrafficController({
    world,
    laneGraph,
    random: new DeterministicRandom('controller-lane-change')
  });
  const edge = laneGraph.edges().find((candidate) => (
    candidate.kind === 'lane' && laneGraph.adjacentLaneEdges(candidate.id).length > 0
  ))!;
  const from = laneGraph.node(edge.fromNodeId)!;
  const to = laneGraph.node(edge.toNodeId)!;
  const progress = 0.2;
  const vehicle = new VehicleState();
  vehicle.id = 'lane-change-controller';
  vehicle.kind = 'sedan';
  vehicle.x = from.x + (to.x - from.x) * progress;
  vehicle.y = from.y + (to.y - from.y) * progress;
  vehicle.angle = Math.atan2(to.y - from.y, to.x - from.x);
  vehicle.speed = 100;
  vehicle.traffic = true;
  const spawn = {
    x: vehicle.x,
    y: vehicle.y,
    angle: vehicle.angle,
    column: Math.floor(vehicle.x / world.tileWidth),
    row: Math.floor(vehicle.y / world.tileHeight),
    targetColumn: Math.floor(to.x / world.tileWidth),
    targetRow: Math.floor(to.y / world.tileHeight),
    laneEdgeId: edge.id,
    laneFromNodeId: edge.fromNodeId,
    laneToNodeId: edge.toNodeId
  };
  controller.register(vehicle.id, spawn, 118);

  const lead = {
    id: 'slow-lead',
    kind: 'vehicle' as const,
    x: vehicle.x + Math.cos(vehicle.angle) * 120,
    y: vehicle.y + Math.sin(vehicle.angle) * 120,
    radius: 20,
    speed: 0,
    angle: vehicle.angle,
    halfLength: 29,
    halfWidth: 16
  };
  const update = (nowMs: number) => {
    controller.beginTick(nowMs);
    controller.update(vehicle, 0, nowMs, {obstacles: [lead]});
    return controller.diagnostics()[0];
  };

  assert.equal(update(100).speedReason, 'vehicle');
  assert.equal(update(200).laneChangePhase, 'none');
  assert.equal(update(1_201).laneChangePhase, 'requesting');
  let diagnostic = update(1_202);
  assert.equal(diagnostic.laneChangePhase, 'change-out');
  assert.equal(diagnostic.laneChangeLeadId, lead.id);
  assert.equal(diagnostic.laneChangeFromLane, 0);
  assert.equal(diagnostic.laneChangeToLane, 1);
  assert.equal(diagnostic.laneChangeTargets.length, 3);

  vehicle.x = diagnostic.laneChangeTargets[0].x;
  vehicle.y = diagnostic.laneChangeTargets[0].y;
  diagnostic = update(1_203);
  assert.equal(diagnostic.laneChangePhase, 'passing');
  vehicle.x = diagnostic.laneChangeTargets[1].x;
  vehicle.y = diagnostic.laneChangeTargets[1].y;
  diagnostic = update(1_204);
  assert.equal(diagnostic.laneChangePhase, 'returning');
  vehicle.x = diagnostic.laneChangeTargets[2].x;
  vehicle.y = diagnostic.laneChangeTargets[2].y;
  diagnostic = update(1_205);
  assert.equal(diagnostic.laneChangePhase, 'none');
  assert.equal(diagnostic.laneChangeCompletions, 1);
});

test('traffic controller yields away from an active police siren and reports the maneuver', () => {
  const world = CollisionMap.load();
  const fixture = createTraffic(world, 'traffic-yield', 211);
  const controller = new TrafficController({
    world,
    random: new DeterministicRandom('traffic-yield')
  });
  controller.register(fixture.vehicle.id, fixture.spawn, 118);
  const emergencyX = fixture.vehicle.x - Math.cos(fixture.vehicle.angle) * 100;
  const emergencyY = fixture.vehicle.y - Math.sin(fixture.vehicle.angle) * 100;
  const before = {x: fixture.vehicle.x, y: fixture.vehicle.y};
  controller.update(fixture.vehicle, 1 / 30, 100, {
    emergencyVehicles: [{
      id: 'police-cruiser',
      x: emergencyX,
      y: emergencyY,
      angle: fixture.vehicle.angle,
      speed: 140,
      siren: true,
      destroyed: false
    }]
  });
  const diagnostic = controller.diagnostics()[0];
  assert.equal(diagnostic.speedReason, 'siren');
  assert.equal(diagnostic.emergencyVehicleId, 'police-cruiser');
  assert.match(diagnostic.emergencyYieldPhase, /^yield-(left|right)$/);
  assert.ok(Math.hypot(fixture.vehicle.x - before.x, fixture.vehicle.y - before.y) > 0);
});

test('traffic controller records blocked routes and selects a deterministic recovery edge', () => {
  const world = {
    tileWidth: 64,
    tileHeight: 64,
    canOccupy: () => false,
    isRoadAt: () => true,
    roadNeighbors: () => [
      {column: 1, row: 0},
      {column: 0, row: 1}
    ]
  } as unknown as CollisionMap;
  const controller = new TrafficController({
    world,
    random: new DeterministicRandom('blocked-traffic')
  });
  const vehicle = new VehicleState();
  vehicle.id = 'blocked';
  vehicle.x = 32;
  vehicle.y = 32;
  vehicle.angle = 0;
  vehicle.speed = 90;
  vehicle.traffic = true;
  controller.register(vehicle.id, {
    x: 32,
    y: 32,
    angle: 0,
    column: 0,
    row: 0,
    targetColumn: 1,
    targetRow: 0
  }, 118);

  controller.update(vehicle, 1 / 30, 100);
  assert.equal(controller.diagnostics()[0].speedReason, 'blocked');
  assert.equal(controller.diagnostics()[0].recoveryCount, 0);
  controller.update(vehicle, 1 / 30, 1300);
  assert.equal(controller.diagnostics()[0].recoveryCount, 0);
  controller.update(vehicle, 1 / 30, 2000);
  assert.equal(controller.diagnostics()[0].recoveryCount, 1);
  assert.equal(controller.diagnostics()[0].blockedSince, 2000);
});

test('opposing traffic spawns on opposite right-hand lane offsets', () => {
  const eastbound = trafficLanePoint({
    x: 100,
    y: 100,
    angle: 0,
    column: 1,
    row: 1,
    targetColumn: 2,
    targetRow: 1
  });
  const westbound = trafficLanePoint({
    x: 100,
    y: 100,
    angle: Math.PI,
    column: 2,
    row: 1,
    targetColumn: 1,
    targetRow: 1
  });

  assert.ok(eastbound.y > 100);
  assert.ok(westbound.y < 100);
  assert.equal(eastbound.x, westbound.x);
  const widestCollider = Math.max(...VEHICLE_KINDS.map((kind) => vehicleDefinition(kind).collision.width));
  assert.ok(
    eastbound.y - westbound.y >= widestCollider + 8,
    'Opposing lane centers must clear the widest vehicle collider plus a safety margin.'
  );
});

test('traffic scans the active route and does not node-snap through a stopping obstacle', () => {
  const world = {
    tileWidth: 64,
    tileHeight: 64,
    canOccupy: () => true,
    isRoadAt: () => true,
    roadNeighbors: () => [{column: 0, row: 2}]
  } as unknown as CollisionMap;
  const controller = new TrafficController({
    world,
    random: new DeterministicRandom('turn-awareness')
  });
  const vehicle = new VehicleState();
  vehicle.id = 'turning';
  vehicle.x = 32;
  vehicle.y = 90;
  vehicle.angle = 0;
  vehicle.speed = 90;
  vehicle.traffic = true;
  controller.register(vehicle.id, {
    x: 32,
    y: 90,
    angle: 0,
    column: 0,
    row: 0,
    targetColumn: 0,
    targetRow: 1
  }, 118);

  controller.update(vehicle, 1 / 30, 100, {
    obstacles: [{
      id: 'crossing-pedestrian',
      kind: 'pedestrian',
      x: 32,
      y: 125,
      radius: 11
    }]
  });
  assert.equal(controller.diagnostics()[0].speedReason, 'pedestrian');
  assert.ok(vehicle.y > 90 && vehicle.y < 96, `Vehicle moved to ${vehicle.y}.`);
});

test('traffic controller breaks a visible mutual blocker cycle with one bounded recovery owner', () => {
  const world = {
    tileWidth: 64,
    tileHeight: 64,
    canOccupy: () => true,
    isRoadAt: () => true,
    roadNeighbors: (column: number) => column === 0
      ? [{column: 1, row: 0}]
      : [{column: 0, row: 0}]
  } as unknown as CollisionMap;
  const controller = new TrafficController({
    world,
    random: new DeterministicRandom('visible-deadlock')
  });
  const left = trafficVehicle('cycle-left', 0, 0, 0);
  const right = trafficVehicle('cycle-right', 96, 0, Math.PI);
  controller.register(left.id, fallbackSpawn(0, 1, 0), 96);
  controller.register(right.id, fallbackSpawn(1, 0, Math.PI), 96);
  let maximumConcurrentOwners = 0;

  for (let tick = 1; tick <= 360; tick++) {
    const nowMs = tick * 1_000 / 30;
    controller.beginTick(nowMs);
    for (const [vehicle, blocker] of [[left, right], [right, left]] as const) {
      const obstacles = [{
        id: blocker.id,
        kind: 'vehicle' as const,
        x: blocker.x,
        y: blocker.y,
        radius: 20,
        speed: blocker.speed,
        angle: blocker.angle,
        halfLength: 23,
        halfWidth: 12
      }, {
        id: `protected-stop:${vehicle.id}`,
        kind: 'signal' as const,
        x: vehicle.x,
        y: vehicle.y + 100,
        radius: 8,
        speed: 0
      }];
      controller.update(vehicle, 1 / 30, nowMs, {obstacles});
      controller.observe(vehicle, nowMs, obstacles);
    }
    maximumConcurrentOwners = Math.max(
      maximumConcurrentOwners,
      controller.diagnostics().filter((entry) => entry.deadlockRecovering).length
    );
  }

  const diagnostics = controller.diagnostics();
  assert.equal(maximumConcurrentOwners, 1);
  assert.equal(diagnostics.reduce((sum, entry) => sum + entry.deadlockRecoveryCount, 0), 1);
  assert.ok(
    Math.hypot(left.x, left.y) > 4 || Math.hypot(right.x - 96, right.y) > 4,
    'The elected recovery owner did not move away from the blocker.'
  );
});

function trafficVehicle(id: string, x: number, y: number, angle: number): VehicleState {
  const vehicle = new VehicleState();
  vehicle.id = id;
  vehicle.x = x;
  vehicle.y = y;
  vehicle.angle = angle;
  vehicle.speed = 0;
  vehicle.traffic = true;
  return vehicle;
}

function fallbackSpawn(column: number, targetColumn: number, angle: number) {
  return {
    x: column * 96,
    y: 0,
    angle,
    column,
    row: 0,
    targetColumn,
    targetRow: 0
  };
}

function createTraffic(world: CollisionMap, id: string, seed: number) {
  const spawn = world.trafficSpawn(seed, 20);
  const vehicle = new VehicleState();
  vehicle.id = id;
  vehicle.x = spawn.x;
  vehicle.y = spawn.y;
  vehicle.angle = spawn.angle;
  vehicle.speed = 90;
  vehicle.traffic = true;
  return {vehicle, spawn};
}

function occupiedJunctionFixture(world: CollisionMap, laneGraph: LaneGraph) {
  for (const junction of laneGraph.junctions()) {
    for (const movement of laneGraph.junctionMovements(junction.id)) {
      // Terminal transfers exercise U-turn routing, not crossing-zone contention.
      if (movement.turn === 'uturn') continue;
      const edge = laneGraph.edge(movement.entryLaneId);
      const from = edge ? laneGraph.node(edge.fromNodeId) : undefined;
      const to = edge ? laneGraph.node(edge.toNodeId) : undefined;
      if (!edge || !from || !to) continue;
      const progress = 0.75;
      const vehicle = new VehicleState();
      vehicle.id = 'junction-waiter';
      vehicle.x = from.x + (to.x - from.x) * progress;
      vehicle.y = from.y + (to.y - from.y) * progress;
      vehicle.angle = Math.atan2(to.y - from.y, to.x - from.x);
      vehicle.speed = 80;
      vehicle.traffic = true;
      const spawn = {
        x: vehicle.x,
        y: vehicle.y,
        angle: vehicle.angle,
        column: Math.floor(vehicle.x / world.tileWidth),
        row: Math.floor(vehicle.y / world.tileHeight),
        targetColumn: Math.floor(to.x / world.tileWidth),
        targetRow: Math.floor(to.y / world.tileHeight),
        laneEdgeId: edge.id,
        laneFromNodeId: edge.fromNodeId,
        laneToNodeId: edge.toNodeId
      };
      const controller = new TrafficController({
        world,
        laneGraph,
        random: new DeterministicRandom('junction-occupancy')
      });
      controller.register(vehicle.id, spawn, 118);
      const middle = movement.path[Math.floor(movement.path.length / 2)];
      const blocker = {
        id: 'player-car',
        kind: 'vehicle' as const,
        x: middle.x,
        y: middle.y,
        radius: 22,
        speed: 0,
        angle: 0
      };
      controller.update(vehicle, 1 / 30, 1_000 / 30, {obstacles: [blocker]});
      if (controller.diagnostics()[0].junctionId === junction.id) {
        return {controller, vehicle, blocker};
      }
    }
  }
  throw new Error('Generated lane graph has no occupiable junction approach.');
}
