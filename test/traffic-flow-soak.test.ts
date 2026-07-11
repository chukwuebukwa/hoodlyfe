import assert from 'node:assert/strict';
import test from 'node:test';
import {VehicleState} from '../server/state.ts';
import {
  TrafficController,
  trafficLanePoint
} from '../server/game/traffic/traffic-controller.ts';
import {DeterministicRandom} from '../server/game/world/deterministic-random.ts';
import {vehicleConfig, VEHICLE_RADIUS} from '../server/game/vehicles/vehicle-config.ts';
import {CollisionMap} from '../server/world-map.ts';

test('a streamed street population continues circulating through a one-minute soak', () => {
  const world = CollisionMap.load();
  const random = new DeterministicRandom('traffic-flow-soak');
  const traffic = new TrafficController({world, random});
  const vehicles: VehicleState[] = [];
  const starts = new Map<string, {x: number; y: number}>();

  for (let index = 0; index < 24; index++) {
    const spawn = world.trafficSpawn(30_000 + index * 307, VEHICLE_RADIUS);
    const lane = trafficLanePoint(spawn);
    if (vehicles.some((vehicle) => Math.hypot(vehicle.x - lane.x, vehicle.y - lane.y) < 64)) continue;
    const vehicle = new VehicleState();
    vehicle.id = `soak-${index}`;
    vehicle.kind = index % 4 === 2 ? 'taxi' : 'sedan';
    vehicle.x = lane.x;
    vehicle.y = lane.y;
    vehicle.angle = spawn.angle;
    vehicle.speed = 80;
    vehicle.traffic = true;
    vehicles.push(vehicle);
    starts.set(vehicle.id, {x: vehicle.x, y: vehicle.y});
    traffic.register(vehicle.id, spawn, vehicleConfig(vehicle.kind).traffic.cruiseSpeed);
  }

  for (let tick = 1; tick <= 1_800; tick++) {
    const nowMs = tick * 1_000 / 30;
    for (const vehicle of vehicles) {
      traffic.update(vehicle, 1 / 30, nowMs, {
        obstacles: vehicles
          .filter((other) => other.id !== vehicle.id &&
            Math.hypot(other.x - vehicle.x, other.y - vehicle.y) <= 280)
          .map((other) => ({
            id: other.id,
            kind: 'vehicle' as const,
            x: other.x,
            y: other.y,
            radius: VEHICLE_RADIUS,
            speed: other.speed,
            angle: other.angle
          }))
      });
    }
  }

  const circulated = vehicles.filter((vehicle) => {
    const start = starts.get(vehicle.id)!;
    return Math.hypot(vehicle.x - start.x, vehicle.y - start.y) >= 160;
  });
  const prolongedBlocks = traffic.diagnostics().filter((entry) => (
    entry.blockedSince > 0 && 60_000 - entry.blockedSince > 8_000
  ));

  assert.ok(vehicles.length >= 16, `Only ${vehicles.length} separated traffic spawns were available.`);
  assert.ok(
    circulated.length >= Math.ceil(vehicles.length * 0.75),
    `Only ${circulated.length}/${vehicles.length} traffic vehicles circulated.`
  );
  assert.ok(
    prolongedBlocks.length <= Math.floor(vehicles.length * 0.15),
    `${prolongedBlocks.length}/${vehicles.length} traffic vehicles remained blocked.`
  );
});
