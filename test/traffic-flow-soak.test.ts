import assert from 'node:assert/strict';
import test from 'node:test';
import {VehicleState} from '../server/state.ts';
import {
  TrafficController,
  trafficLanePoint
} from '../server/game/traffic/traffic-controller.ts';
import {DeterministicRandom} from '../server/game/world/deterministic-random.ts';
import {LaneGraph} from '../server/game/traffic/lane-graph.ts';
import {vehicleConfig, VEHICLE_RADIUS} from '../server/game/vehicles/vehicle-config.ts';
import {CollisionMap} from '../server/world-map.ts';
import {interactionShapesOverlap} from '../shared/physics/interaction-contact-geometry.ts';

test('a streamed street population continues circulating through a one-minute soak', () => {
  const world = CollisionMap.load();
  const random = new DeterministicRandom('traffic-flow-soak');
  const traffic = new TrafficController({world, random, laneGraph: LaneGraph.load(world)});
  const vehicles: VehicleState[] = [];
  const starts = new Map<string, {x: number; y: number}>();
  const previousJunctionPhase = new Map<string, string>();
  const observedJunctionPhases = new Set<string>();
  let completedJunctionTraversals = 0;
  let maximumQueuePosition = 0;
  let maximumConcurrentOverlaps = 0;
  let overlapPairTicks = 0;
  let maximumDeadlockCycles = 0;
  let deadlockRecoveryCount = 0;

  for (let index = 0; index < 24; index++) {
    const spawn = traffic.spawn(30_000 + index * 307, VEHICLE_RADIUS);
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
    traffic.beginTick(nowMs);
    for (const vehicle of vehicles) {
      const obstacles = vehicles
        .filter((other) => other.id !== vehicle.id &&
          Math.hypot(other.x - vehicle.x, other.y - vehicle.y) <= 280)
        .map((other) => ({
          halfLength: vehicleConfig(other.kind).collision.length / 2,
          halfWidth: vehicleConfig(other.kind).collision.width / 2,
          id: other.id,
          kind: 'vehicle' as const,
          x: other.x,
          y: other.y,
          radius: VEHICLE_RADIUS,
          speed: other.speed,
          angle: other.angle
        }));
      traffic.update(vehicle, 1 / 30, nowMs, {obstacles});
      traffic.observe(vehicle, nowMs, obstacles);
    }
    const diagnostics = traffic.diagnostics();
    maximumDeadlockCycles = Math.max(maximumDeadlockCycles, new Set(diagnostics
      .filter((entry) => entry.deadlockCycleId)
      .map((entry) => entry.deadlockCycleId)).size);
    deadlockRecoveryCount = Math.max(
      deadlockRecoveryCount,
      diagnostics.reduce((sum, entry) => sum + entry.deadlockRecoveryCount, 0)
    );
    const ownersByJunction = new Map<string, number>();
    for (const entry of diagnostics) {
      observedJunctionPhases.add(entry.junctionPhase);
      maximumQueuePosition = Math.max(maximumQueuePosition, entry.junctionQueuePosition);
      const previous = previousJunctionPhase.get(entry.vehicleId) ?? 'none';
      if (previous === 'clearing' && entry.junctionPhase === 'none') completedJunctionTraversals++;
      previousJunctionPhase.set(entry.vehicleId, entry.junctionPhase);
      if (!['approach', 'crossing', 'clearing'].includes(entry.junctionPhase)) continue;
      ownersByJunction.set(entry.junctionId, (ownersByJunction.get(entry.junctionId) ?? 0) + 1);
    }
    assert.ok(
      [...ownersByJunction.values()].every((owners) => owners === 1),
      'A junction admitted more than one active owner in the same tick.'
    );
    let overlapsThisTick = 0;
    for (let left = 0; left < vehicles.length; left++) {
      for (let right = left + 1; right < vehicles.length; right++) {
        if (vehicleBoxesOverlap(vehicles[left], vehicles[right])) overlapsThisTick++;
      }
    }
    maximumConcurrentOverlaps = Math.max(maximumConcurrentOverlaps, overlapsThisTick);
    overlapPairTicks += overlapsThisTick;
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
  assert.deepEqual(
    [...observedJunctionPhases].sort(),
    ['approach', 'clearing', 'crossing', 'none', 'waiting']
  );
  assert.ok(
    completedJunctionTraversals >= vehicles.length * 3,
    `Only ${completedJunctionTraversals} junction traversals completed for ${vehicles.length} vehicles.`
  );
  assert.ok(maximumQueuePosition <= 6, `Junction queue reached position ${maximumQueuePosition}.`);
  assert.ok(
    maximumConcurrentOverlaps <= 1,
    `${maximumConcurrentOverlaps} traffic vehicle pairs overlapped concurrently.`
  );
  assert.ok(
    overlapPairTicks <= 60,
    `Traffic vehicle boxes overlapped for ${overlapPairTicks} pair-ticks.`
  );
  if (process.env.TRAFFIC_SOAK_TRACE === '1') {
    console.log(JSON.stringify({
      vehicles: vehicles.length,
      circulated: circulated.length,
      completedJunctionTraversals,
      maximumQueuePosition,
      maximumConcurrentOverlaps,
      overlapPairTicks,
      maximumDeadlockCycles,
      deadlockRecoveryCount
    }));
  }
});

function vehicleBoxesOverlap(left: VehicleState, right: VehicleState): boolean {
  const leftCollision = vehicleConfig(left.kind).collision;
  const rightCollision = vehicleConfig(right.kind).collision;
  return interactionShapesOverlap({
    shape: 'box',
    x: left.x,
    y: left.y,
    angle: left.angle,
    halfLength: leftCollision.length / 2,
    halfWidth: leftCollision.width / 2
  }, {
    shape: 'box',
    x: right.x,
    y: right.y,
    angle: right.angle,
    halfLength: rightCollision.length / 2,
    halfWidth: rightCollision.width / 2
  });
}
