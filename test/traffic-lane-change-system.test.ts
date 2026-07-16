import assert from 'node:assert/strict';
import test from 'node:test';
import {
  TrafficLaneChangeSystem,
  type TrafficLaneChangeRuntime
} from '../server/game/traffic/traffic-lane-change-system.ts';
import type {TrafficObstacle} from '../server/game/traffic/traffic-awareness-system.ts';
import type {TrafficLaneSegment} from '../server/game/traffic/traffic-route-system.ts';
import {VehicleState} from '../server/state.ts';
import type {CollisionMap} from '../server/world-map.ts';

const openRoad = {
  canOccupy: () => true,
  isRoadAt: () => true
} as unknown as CollisionMap;

test('lane-change reservations choose one deterministic winner per target-lane segment', () => {
  const system = new TrafficLaneChangeSystem(openRoad);
  const left = runtimeAndVehicle(system, 'traffic-b');
  const right = runtimeAndVehicle(system, 'traffic-a');

  request(system, left.vehicle, left.runtime, 0);
  request(system, right.vehicle, right.runtime, 0);
  assert.equal(request(system, left.vehicle, left.runtime, 901).phase, 'requesting');
  assert.equal(request(system, right.vehicle, right.runtime, 901).phase, 'requesting');

  system.beginTick(902);
  assert.equal(request(system, left.vehicle, left.runtime, 902).phase, 'requesting');
  assert.equal(request(system, right.vehicle, right.runtime, 902).phase, 'change-out');
  assert.equal(right.runtime.reservationKey, 'road:forward:lane-1:edge:0:0');
  assert.equal(left.runtime.reservationKey, '');
});

test('lane-change runtime progresses through pass and return before releasing ownership', () => {
  const system = new TrafficLaneChangeSystem(openRoad);
  const {vehicle, runtime} = runtimeAndVehicle(system, 'traffic-a');

  request(system, vehicle, runtime, 0);
  assert.equal(request(system, vehicle, runtime, 901).phase, 'requesting');
  system.beginTick(902);
  assert.equal(request(system, vehicle, runtime, 902).phase, 'change-out');

  vehicle.x = runtime.entryX;
  vehicle.y = runtime.entryY;
  assert.equal(request(system, vehicle, runtime, 903).phase, 'passing');
  vehicle.x = runtime.passX;
  vehicle.y = runtime.passY;
  assert.equal(request(system, vehicle, runtime, 904).phase, 'returning');
  vehicle.x = runtime.returnX;
  vehicle.y = runtime.returnY;
  assert.equal(request(system, vehicle, runtime, 905).phase, 'none');
  assert.equal(runtime.phase, 'none');
  assert.equal(runtime.completions, 1);
  assert.equal(runtime.attempts, 1);
  assert.ok(runtime.cooldownUntil > 905);
});

test('lane-change requests cancel when a protected junction takes priority', () => {
  const system = new TrafficLaneChangeSystem(openRoad);
  const {vehicle, runtime} = runtimeAndVehicle(system, 'traffic-a');

  request(system, vehicle, runtime, 0);
  assert.equal(request(system, vehicle, runtime, 901).phase, 'requesting');
  assert.equal(request(system, vehicle, runtime, 902, true).phase, 'none');
  system.beginTick(903);
  assert.equal(runtime.phase, 'none');
  assert.equal(runtime.reservationKey, '');
});

function request(
  system: TrafficLaneChangeSystem,
  vehicle: VehicleState,
  runtime: TrafficLaneChangeRuntime,
  nowMs: number,
  protectedJunction = false
) {
  return system.command({
    vehicle,
    runtime,
    segment: segment(),
    obstacles: [lead()],
    speedReason: 'vehicle',
    obstacleId: 'lead',
    desiredSpeed: 0,
    cruiseSpeed: 100,
    protectedJunction,
    nowMs
  });
}

function runtimeAndVehicle(system: TrafficLaneChangeSystem, id: string) {
  const vehicle = new VehicleState();
  vehicle.id = id;
  vehicle.kind = 'sedan';
  vehicle.x = 100;
  vehicle.y = 0;
  vehicle.angle = 0;
  vehicle.speed = 20;
  vehicle.traffic = true;
  return {vehicle, runtime: system.createRuntime()};
}

function lead(): TrafficObstacle {
  return {
    id: 'lead',
    kind: 'vehicle',
    x: 220,
    y: 0,
    radius: 20,
    speed: 0,
    angle: 0,
    halfLength: 20,
    halfWidth: 10
  };
}

function segment(): TrafficLaneSegment {
  return {
    edgeId: 'road:forward:edge:0',
    corridorId: 'road',
    direction: 'forward',
    laneIndex: 0,
    laneCount: 2,
    fromX: 0,
    fromY: 0,
    toX: 600,
    toY: 0,
    adjacent: [{
      edgeId: 'road:forward:lane-1:edge:0',
      laneIndex: 1,
      fromX: 0,
      fromY: 40,
      toX: 600,
      toY: 40
    }]
  };
}
