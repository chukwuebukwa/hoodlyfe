import assert from 'node:assert/strict';
import test from 'node:test';
import {DistrictRoom} from '../server/district-room.ts';
import {DistrictState, NpcState, PlayerState, VehicleState} from '../server/state.ts';
import {attachTestVehicleSimulation} from './support/vehicle-simulation.ts';
import {VEHICLE_SIMULATION_STEP_SECONDS} from '../shared/simulation/vehicle-step.ts';

test('authoritative vehicle-humanoid phase runs after body motion and uses OBB contact', () => {
  const fixture = contactFixture();
  fixture.vehicle.speed = 120;
  fixture.player.x = fixture.vehicle.x + 35;
  fixture.player.y = fixture.vehicle.y;

  fixture.room.vehicleSimulation.beginTick();
  fixture.player.x += 1;
  fixture.vehicle.x += fixture.vehicle.speed * VEHICLE_SIMULATION_STEP_SECONDS;
  const result = fixture.room.vehicleSimulation.stepPhysics(
    VEHICLE_SIMULATION_STEP_SECONDS,
    1_000
  );

  assert.equal(result.contacts, 1);
  assert.equal(result.damagingContacts, 1);
  assert.equal(fixture.player.health, 55);
  assert.ok(fixture.player.x >= 1036);
  assert.equal(fixture.vehicle.x, 1004);
  assert.equal(fixture.vehicle.speed, 120);
  assert.deepEqual(result.players.map((player: PlayerState) => player.id), ['target']);
  assert.deepEqual(result.vehicles.map((vehicle: VehicleState) => vehicle.id), ['car']);
});

test('low-speed overlaps separate without damage and OBB corner misses do not collide', () => {
  const fixture = contactFixture();
  fixture.vehicle.speed = 20;
  fixture.player.x = fixture.vehicle.x + 35;
  fixture.player.y = fixture.vehicle.y;
  fixture.room.vehicleSimulation.beginTick();
  fixture.vehicle.x += fixture.vehicle.speed * VEHICLE_SIMULATION_STEP_SECONDS;

  const separated = fixture.room.vehicleSimulation.stepPhysics(
    VEHICLE_SIMULATION_STEP_SECONDS,
    1_000
  );
  assert.equal(separated.contacts, 1);
  assert.equal(separated.damagingContacts, 0);
  assert.equal(fixture.player.health, 100);

  fixture.player.x = fixture.vehicle.x + 50;
  fixture.player.y = fixture.vehicle.y + 35;
  fixture.room.vehicleSimulation.beginTick();
  const missed = fixture.room.vehicleSimulation.stepPhysics(
    VEHICLE_SIMULATION_STEP_SECONDS,
    1_100
  );
  assert.equal(missed.contacts, 0);
});

test('walking into a parked vehicle separates without damage', () => {
  const fixture = contactFixture();
  fixture.player.x = fixture.vehicle.x + 41;
  fixture.player.y = fixture.vehicle.y;
  fixture.room.vehicleSimulation.beginTick();
  fixture.player.x -= 190 * VEHICLE_SIMULATION_STEP_SECONDS;

  const result = fixture.room.vehicleSimulation.stepPhysics(
    VEHICLE_SIMULATION_STEP_SECONDS,
    1_000
  );

  assert.equal(result.contacts, 1);
  assert.equal(result.damagingContacts, 0);
  assert.equal(fixture.player.health, 100);
  assert.equal(fixture.vehicle.x, 1000);
});

test('per-pair impact records damage distinct pedestrians and debounce only repeats', () => {
  const fixture = contactFixture();
  const npc = new NpcState();
  npc.id = 'npc-target';
  npc.x = fixture.vehicle.x + 35;
  npc.y = fixture.vehicle.y + 8;
  npc.health = 100;
  fixture.room.state.npcs.set(npc.id, npc);
  fixture.vehicle.speed = 150;
  fixture.player.x = fixture.vehicle.x + 35;
  fixture.player.y = fixture.vehicle.y - 8;

  fixture.room.vehicleSimulation.beginTick();
  fixture.vehicle.x += fixture.vehicle.speed * VEHICLE_SIMULATION_STEP_SECONDS;
  const first = fixture.room.vehicleSimulation.stepPhysics(
    VEHICLE_SIMULATION_STEP_SECONDS,
    1_000
  );
  assert.equal(first.damagingContacts, 2);
  assert.equal(fixture.player.health, 55);
  assert.ok(npc.health < 100);

  fixture.vehicle.speed = 150;
  npc.x = fixture.vehicle.x + 200;
  fixture.player.x = fixture.vehicle.x + 35;
  fixture.player.y = fixture.vehicle.y;
  fixture.room.vehicleSimulation.beginTick();
  fixture.vehicle.x += fixture.vehicle.speed * VEHICLE_SIMULATION_STEP_SECONDS;
  const repeated = fixture.room.vehicleSimulation.stepPhysics(
    VEHICLE_SIMULATION_STEP_SECONDS,
    1_100
  );
  assert.equal(repeated.contacts, 1);
  assert.equal(repeated.damagingContacts, 0);
  assert.equal(fixture.player.health, 55);
});

test('contact outcome is independent of humanoid insertion order', () => {
  const forward = multiContactFixture(['alpha', 'bravo']);
  const reverse = multiContactFixture(['bravo', 'alpha']);

  advance(forward);
  advance(reverse);

  assert.deepEqual(snapshot(reverse), snapshot(forward));
});

function contactFixture() {
  const room = new DistrictRoom() as any;
  room.world = {canOccupy: () => true};
  room.setState(new DistrictState());
  const vehicle = new VehicleState();
  vehicle.id = 'car';
  vehicle.kind = 'sedan';
  vehicle.x = 1000;
  vehicle.y = 1000;
  const player = new PlayerState();
  player.id = 'target';
  player.spaceId = 'street';
  room.state.vehicles.set(vehicle.id, vehicle);
  room.state.players.set(player.id, player);
  attachTestVehicleSimulation(room);
  return {room, vehicle, player};
}

function multiContactFixture(order: readonly string[]) {
  const fixture = contactFixture();
  fixture.room.state.players.delete(fixture.player.id);
  const players = new Map<string, PlayerState>();
  for (const id of order) {
    const player = new PlayerState();
    player.id = id;
    player.x = fixture.vehicle.x + 35;
    player.y = fixture.vehicle.y + (id === 'alpha' ? -8 : 8);
    players.set(id, player);
    fixture.room.state.players.set(id, player);
  }
  fixture.vehicle.speed = 150;
  return {...fixture, players};
}

function advance(fixture: ReturnType<typeof multiContactFixture>): void {
  fixture.room.vehicleSimulation.beginTick();
  fixture.vehicle.x += fixture.vehicle.speed * VEHICLE_SIMULATION_STEP_SECONDS;
  fixture.room.vehicleSimulation.stepPhysics(VEHICLE_SIMULATION_STEP_SECONDS, 1_000);
}

function snapshot(fixture: ReturnType<typeof multiContactFixture>) {
  return {
    vehicle: {
      x: fixture.vehicle.x,
      y: fixture.vehicle.y,
      speed: fixture.vehicle.speed
    },
    players: [...fixture.players.values()]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((player) => ({id: player.id, x: player.x, y: player.y, health: player.health}))
  };
}
