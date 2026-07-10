import assert from 'node:assert/strict';
import test from 'node:test';
import {TrafficManeuverSystem} from '../server/game/traffic/traffic-maneuver-system.ts';
import {VehicleState} from '../server/state.ts';
import type {CollisionMap} from '../server/world-map.ts';

const openRoad = {
  canOccupy: () => true,
  isRoadAt: () => true
} as unknown as CollisionMap;

test('stopped traffic deterministically reverses, passes, and merges around a lead car', () => {
  const system = new TrafficManeuverSystem(openRoad);
  const runtime = system.createRuntime();
  const vehicle = trafficVehicle('traffic-pass', 100, 100);
  const obstacles = [{
    id: 'disabled-lead',
    kind: 'vehicle' as const,
    x: 155,
    y: 100,
    radius: 20,
    speed: 0,
    angle: 0
  }];
  const input = {
    vehicle,
    runtime,
    routeTargetX: 300,
    routeTargetY: 100,
    obstacles,
    speedReason: 'vehicle',
    obstacleId: 'disabled-lead',
    desiredSpeed: 0
  };

  assert.equal(system.command({...input, nowMs: 100}).phase, 'none');
  assert.equal(system.command({...input, nowMs: 2_101}).phase, 'reverse');
  const pass = system.command({...input, nowMs: 2_752});
  assert.match(pass.phase, /^pass-(left|right)$/);
  assert.equal(pass.ignoredObstacleIds?.has('disabled-lead'), true);

  vehicle.x = pass.targetX!;
  vehicle.y = pass.targetY!;
  const merge = system.command({...input, nowMs: 2_800});
  assert.equal(merge.phase, 'merge');
  assert.ok(merge.targetX! > obstacles[0].x);

  vehicle.x = merge.targetX!;
  vehicle.y = merge.targetY!;
  assert.equal(system.command({...input, nowMs: 2_900}).phase, 'none');
  assert.equal(runtime.attempts, 1);
});

test('traffic does not overtake a queue protected by a signal or pedestrian', () => {
  for (const protectedKind of ['signal', 'pedestrian'] as const) {
    const system = new TrafficManeuverSystem(openRoad);
    const runtime = system.createRuntime();
    const vehicle = trafficVehicle(`traffic-${protectedKind}`, 100, 100);
    const obstacles = [{
      id: 'lead',
      kind: 'vehicle' as const,
      x: 150,
      y: 100,
      radius: 20,
      speed: 0,
      angle: 0
    }, {
      id: protectedKind,
      kind: protectedKind,
      x: 190,
      y: 100,
      radius: 0
    }];
    const input = {
      vehicle,
      runtime,
      routeTargetX: 300,
      routeTargetY: 100,
      obstacles,
      speedReason: 'vehicle',
      obstacleId: 'lead',
      desiredSpeed: 0
    };
    system.command({...input, nowMs: 100});
    assert.equal(system.command({...input, nowMs: 5_000}).phase, 'none');
    assert.equal(runtime.attempts, 0);
  }
});

function trafficVehicle(id: string, x: number, y: number): VehicleState {
  const vehicle = new VehicleState();
  vehicle.id = id;
  vehicle.x = x;
  vehicle.y = y;
  vehicle.angle = 0;
  vehicle.speed = 0;
  vehicle.traffic = true;
  return vehicle;
}
