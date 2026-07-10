import assert from 'node:assert/strict';
import test from 'node:test';
import {AMMUNITION_CAPACITY, vehicleRepairQuote} from '../shared/content/street-services.ts';
import {StreetEconomyController} from '../server/game/economy/street-economy-controller.ts';
import {GameEventStream} from '../server/game/events/game-events.ts';
import {StreetServiceController} from '../server/game/services/street-service-controller.ts';
import {DistrictState, PlayerState, VehicleState} from '../server/state.ts';
import {CollisionMap} from '../server/world-map.ts';

test('street services initialize once at collision-safe authoritative locations', () => {
  const fixture = createFixture();
  fixture.services.initialize();
  fixture.services.initialize();

  assert.equal(fixture.state.services.size, 2);
  assert.deepEqual([...fixture.state.services.values()].map((service) => service.id).sort(), [
    'ammunition-counter',
    'repair-garage'
  ]);
  for (const service of fixture.state.services.values()) {
    assert.equal(fixture.world.canOccupy(service.x, service.y, 11), true);
  }
});

test('repair garage atomically charges and restores an eligible vehicle', () => {
  const fixture = createFixture();
  fixture.services.initialize();
  fixture.player.cash = 1000;
  const garage = fixture.state.services.get('repair-garage');
  assert.ok(garage);
  const vehicle = createDamagedVehicle(fixture.player.id, garage.x, garage.y);
  fixture.state.vehicles.set(vehicle.id, vehicle);
  fixture.player.vehicleId = vehicle.id;
  fixture.player.vehicleSeat = 0;
  const quote = vehicleRepairQuote(vehicle);

  assert.equal(fixture.services.interact(fixture.player.id, 1000), true);
  assert.equal(fixture.player.cash, 1000 - quote);
  assert.equal(vehicle.health, vehicle.maxHealth);
  assert.equal(vehicle.engineDamage, 0);
  assert.equal(vehicle.damageFront, 0);
  assert.equal(fixture.repairCount(), 1);
  assert.equal(fixture.notices.at(-1)?.message, `Vehicle repaired -$${quote}`);
  assert.equal(fixture.services.interact(fixture.player.id, 1001), false);
  assert.equal(fixture.economy.size, 1);
});

test('repair rejection preserves cash and damage while consuming the interaction', () => {
  const fixture = createFixture();
  fixture.services.initialize();
  fixture.player.cash = 1000;
  fixture.player.wanted = 1;
  const garage = fixture.state.services.get('repair-garage');
  assert.ok(garage);
  const vehicle = createDamagedVehicle(fixture.player.id, garage.x, garage.y);
  fixture.state.vehicles.set(vehicle.id, vehicle);
  fixture.player.vehicleId = vehicle.id;
  fixture.player.vehicleSeat = 0;

  assert.equal(fixture.services.interact(fixture.player.id, 2000), true);
  assert.equal(fixture.player.cash, 1000);
  assert.equal(vehicle.health, 700);
  assert.equal(fixture.repairCount(), 0);
  assert.match(fixture.notices.at(-1)?.message ?? '', /Lose police heat/);
  assert.equal(fixture.economy.size, 0);
});

test('ammunition counter charges the computed quote and restores every weapon reserve', () => {
  const fixture = createFixture();
  fixture.services.initialize();
  fixture.player.cash = 1000;
  fixture.player.ammoPistol = 0;
  fixture.player.ammoSmg = 40;
  fixture.player.ammoShotgun = 8;
  const counter = fixture.state.services.get('ammunition-counter');
  assert.ok(counter);
  fixture.player.x = counter.x;
  fixture.player.y = counter.y;

  assert.equal(fixture.services.interact(fixture.player.id, 3000), true);
  assert.equal(fixture.player.cash, 810);
  assert.equal(fixture.player.ammoPistol, AMMUNITION_CAPACITY.ammoPistol);
  assert.equal(fixture.player.ammoSmg, AMMUNITION_CAPACITY.ammoSmg);
  assert.equal(fixture.player.ammoShotgun, AMMUNITION_CAPACITY.ammoShotgun);
  assert.equal(fixture.restockCount(), 1);
  assert.equal(fixture.notices.at(-1)?.message, 'Ammunition restocked -$190');
});

function createFixture() {
  const state = new DistrictState();
  const world = CollisionMap.load();
  const events = new GameEventStream();
  const player = new PlayerState();
  player.id = 'driver';
  player.name = 'Driver';
  player.x = world.spawn.x;
  player.y = world.spawn.y;
  state.players.set(player.id, player);
  let tick = 17;
  let repairs = 0;
  let restocks = 0;
  const notices: Array<{playerId: string; message: string; tone: string}> = [];
  const economy = new StreetEconomyController({state, events, clock: () => ({tick})});
  const services = new StreetServiceController({
    state,
    world,
    economy,
    clock: () => ({tick}),
    repairVehicle: (vehicle) => {
      repairs += 1;
      vehicle.health = vehicle.maxHealth;
      vehicle.engineDamage = 0;
      vehicle.damageFront = 0;
      vehicle.damageRear = 0;
      vehicle.damageLeft = 0;
      vehicle.damageRight = 0;
      vehicle.onFire = false;
      vehicle.fireStartedAt = 0;
    },
    restockPlayer: (playerId) => {
      restocks += 1;
      const target = state.players.get(playerId);
      if (!target) return;
      target.ammoPistol = AMMUNITION_CAPACITY.ammoPistol;
      target.ammoSmg = AMMUNITION_CAPACITY.ammoSmg;
      target.ammoShotgun = AMMUNITION_CAPACITY.ammoShotgun;
    },
    medical: {
      canTreat: () => false,
      treat: () => false
    },
    notice: (playerId, message, tone) => notices.push({playerId, message, tone})
  });
  return {
    state,
    world,
    player,
    economy,
    services,
    notices,
    repairCount: () => repairs,
    restockCount: () => restocks,
    setTick: (value: number) => { tick = value; }
  };
}

function createDamagedVehicle(driverId: string, x: number, y: number): VehicleState {
  const vehicle = new VehicleState();
  vehicle.id = 'damaged-car';
  vehicle.x = x;
  vehicle.y = y;
  vehicle.driverId = driverId;
  vehicle.health = 700;
  vehicle.engineDamage = 100;
  vehicle.damageFront = 100;
  return vehicle;
}
