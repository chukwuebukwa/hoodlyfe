import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PoliceResponseFleetController,
  responseSpawnInterval,
  responseVehicleLimit
} from '../server/game/police/police-response-fleet-controller.ts';
import {DistrictState, PlayerState, VehicleState} from '../server/state.ts';
import {CollisionMap} from '../server/world-map.ts';
import {vehicleConfig} from '../server/game/vehicles/vehicle-config.ts';

test('response policy bounds units and increases reinforcement cadence with heat', () => {
  assert.deepEqual([-1, 0, 1, 2, 3, 5].map(responseVehicleLimit), [0, 0, 1, 2, 3, 3]);
  assert.equal(responseSpawnInterval(1), 5_000);
  assert.equal(responseSpawnInterval(2), 3_000);
  assert.equal(responseSpawnInterval(3), 1_800);
});

test('fleet scales to heat through delayed, clear, road-reachable reinforcements', () => {
  const fixture = createFixture(3);
  fixture.controller.update(0);
  assert.equal(fixture.controller.managedVehicleIds().length, 1);
  fixture.controller.update(1_799);
  assert.equal(fixture.controller.managedVehicleIds().length, 1);
  fixture.controller.update(1_800);
  fixture.controller.update(3_600);
  assert.equal(fixture.controller.managedVehicleIds().length, 3);

  const vehicles = fixture.controller.managedVehicleIds()
    .map((id) => fixture.state.vehicles.get(id)!);
  for (const vehicle of vehicles) {
    const distance = Math.hypot(vehicle.x - fixture.player.x, vehicle.y - fixture.player.y);
    assert.ok(distance >= 420 && distance <= 1_360, `Unexpected response distance ${distance}`);
    assert.equal(vehicle.kind, 'police');
    assert.equal(vehicle.traffic, true);
    assert.equal(fixture.police.has(vehicle.id), true);
  }
  for (let left = 0; left < vehicles.length; left++) {
    for (let right = left + 1; right < vehicles.length; right++) {
      assert.ok(Math.hypot(
        vehicles[left].x - vehicles[right].x,
        vehicles[left].y - vehicles[right].y
      ) >= 96);
    }
  }
});

test('available authored cruiser satisfies low heat without duplicating response cars', () => {
  const fixture = createFixture(1);
  const authored = createPoliceVehicle('vehicle-2', fixture.world.spawn.x + 640, fixture.world.spawn.y);
  fixture.state.vehicles.set(authored.id, authored);
  fixture.police.register(authored.id);

  fixture.controller.update(0);
  assert.equal(fixture.controller.managedVehicleIds().length, 0);
  assert.equal(fixture.controller.diagnostics().availableUnits, 1);
});

test('hijacked response car leaves fleet ownership and can be replaced', () => {
  const fixture = createFixture(2);
  fixture.controller.update(0);
  const hijackedId = fixture.controller.managedVehicleIds()[0];
  const hijacked = fixture.state.vehicles.get(hijackedId)!;
  hijacked.hijackBy = fixture.player.id;

  fixture.controller.update(3_000);
  assert.equal(fixture.state.vehicles.has(hijackedId), true);
  assert.equal(fixture.police.has(hijackedId), false);
  assert.deepEqual(fixture.controller.managedVehicleIds(), ['police-response-2']);
});

test('stand-down removes only managed, clear response cars after a grace period', () => {
  const fixture = createFixture(1);
  fixture.controller.update(0);
  const responseId = fixture.controller.managedVehicleIds()[0];
  fixture.player.wanted = 0;
  fixture.controller.update(100);
  fixture.player.x = 100_000;
  fixture.player.y = 100_000;
  fixture.controller.update(7_599);
  assert.equal(fixture.state.vehicles.has(responseId), true);
  fixture.controller.update(7_600);
  assert.equal(fixture.state.vehicles.has(responseId), false);
  assert.equal(fixture.police.has(responseId), false);
});

function createFixture(wanted: number) {
  const state = new DistrictState();
  const world = CollisionMap.load();
  const player = new PlayerState();
  player.id = 'suspect-1';
  player.name = 'Suspect';
  player.x = world.spawn.x;
  player.y = world.spawn.y;
  player.wanted = wanted;
  state.players.set(player.id, player);
  const police = new PoliceRegistry();
  const controller = new PoliceResponseFleetController({state, world, police});
  return {state, world, player, police, controller};
}

function createPoliceVehicle(id: string, x: number, y: number): VehicleState {
  const vehicle = new VehicleState();
  vehicle.id = id;
  vehicle.kind = 'police';
  vehicle.x = x;
  vehicle.y = y;
  vehicle.maxHealth = vehicleConfig(vehicle.kind).maxHealth;
  vehicle.health = vehicle.maxHealth;
  return vehicle;
}

class PoliceRegistry {
  private readonly ids = new Set<string>();

  register(vehicleId: string): void {
    this.ids.add(vehicleId);
  }

  release(vehicleId: string): void {
    this.ids.delete(vehicleId);
  }

  has(vehicleId: string): boolean {
    return this.ids.has(vehicleId);
  }
}
