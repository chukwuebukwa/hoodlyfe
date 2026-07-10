import assert from 'node:assert/strict';
import test from 'node:test';
import {PedestrianController} from '../server/game/pedestrians/pedestrian-controller.ts';
import {DistrictPopulationController} from '../server/game/population/district-population-controller.ts';
import {TrafficController} from '../server/game/traffic/traffic-controller.ts';
import {VEHICLE_RADIUS, vehicleConfig} from '../server/game/vehicles/vehicle-config.ts';
import {DeterministicRandom} from '../server/game/world/deterministic-random.ts';
import {DistrictState} from '../server/state.ts';
import {CollisionMap} from '../server/world-map.ts';

test('district bootstrap creates deterministic valid population exactly once', () => {
  const first = createPopulation('district-population');
  const second = createPopulation('district-population');

  assert.deepEqual(first.population.populate(), {
    civilians: 10,
    police: 3,
    parkedVehicles: 3,
    trafficVehicles: 8
  });
  second.population.populate();

  assert.equal(first.state.npcs.size, 13);
  assert.equal(first.state.vehicles.size, 11);
  assert.equal(first.spawnedVehicles.length, 11);
  assert.equal(first.state.missionContactX, first.world.spawn.x);
  assert.equal(first.state.missionContactY, first.world.spawn.y);
  assert.deepEqual(
    [...first.state.npcs.values()].map((npc) => ({
      id: npc.id,
      kind: npc.kind,
      x: npc.x,
      y: npc.y,
      angle: npc.angle,
      health: npc.health
    })),
    [...second.state.npcs.values()].map((npc) => ({
      id: npc.id,
      kind: npc.kind,
      x: npc.x,
      y: npc.y,
      angle: npc.angle,
      health: npc.health
    }))
  );
  assert.deepEqual(
    [...first.state.vehicles.values()].map(vehicleSnapshot),
    [...second.state.vehicles.values()].map(vehicleSnapshot)
  );

  for (const npc of first.state.npcs.values()) {
    assert.equal(first.world.canOccupy(npc.x, npc.y, 10), true);
  }
  for (const vehicle of first.state.vehicles.values()) {
    assert.equal(first.world.canOccupy(vehicle.x, vehicle.y, VEHICLE_RADIUS), true);
    assert.equal(vehicle.maxHealth, vehicleConfig(vehicle.kind).maxHealth);
    assert.equal(vehicle.health, vehicle.maxHealth);
    if (vehicle.traffic) assert.equal(first.world.isRoadAt(vehicle.x, vehicle.y), true);
  }

  const beforeSecondCall = {
    npcs: first.state.npcs.size,
    vehicles: first.state.vehicles.size,
    callbacks: first.spawnedVehicles.length
  };
  assert.deepEqual(first.population.populate(), {
    civilians: 10,
    police: 3,
    parkedVehicles: 3,
    trafficVehicles: 8
  });
  assert.deepEqual({
    npcs: first.state.npcs.size,
    vehicles: first.state.vehicles.size,
    callbacks: first.spawnedVehicles.length
  }, beforeSecondCall);
});

test('bootstrapped traffic is registered and moves on district roads', () => {
  const {population, state, traffic, world} = createPopulation('traffic-bootstrap');
  population.populate();
  const vehicle = state.vehicles.get('traffic-1');
  assert.ok(vehicle);
  const start = {x: vehicle.x, y: vehicle.y};

  for (let tick = 1; tick <= 120; tick++) {
    traffic.update(vehicle, 1 / 30, tick * 1000 / 30);
  }

  assert.ok(Math.hypot(vehicle.x - start.x, vehicle.y - start.y) > 20);
  assert.equal(world.isRoadAt(vehicle.x, vehicle.y), true);
});

function createPopulation(seed: string) {
  const state = new DistrictState();
  const world = CollisionMap.load();
  const random = new DeterministicRandom(seed);
  const traffic = new TrafficController({world, random});
  const pedestrians = new PedestrianController({
    state,
    world,
    random,
    clock: () => ({tick: 0}),
    policeTarget: () => undefined,
    requestPoliceFire: () => undefined
  });
  const spawnedVehicles: string[] = [];
  const population = new DistrictPopulationController({
    state,
    world,
    pedestrians,
    traffic,
    onVehicleSpawned: (vehicle) => spawnedVehicles.push(vehicle.id)
  });
  return {population, state, traffic, world, spawnedVehicles};
}

function vehicleSnapshot(vehicle: {
  id: string;
  kind: string;
  x: number;
  y: number;
  angle: number;
  speed: number;
  traffic: boolean;
}) {
  return {
    id: vehicle.id,
    kind: vehicle.kind,
    x: vehicle.x,
    y: vehicle.y,
    angle: vehicle.angle,
    speed: vehicle.speed,
    traffic: vehicle.traffic
  };
}
