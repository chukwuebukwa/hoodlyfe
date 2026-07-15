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
  assert.ok(circulated.routeRevision > 1);
  assert.equal(circulated.routeSource, 'lane-graph');
  assert.ok(circulated.currentLaneNodeId);
  assert.ok(circulated.destinationLaneNodeId);
  assert.equal(world.isRoadAt(vehicle.x, vehicle.y), true);
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
