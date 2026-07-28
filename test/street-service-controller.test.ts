import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AMMUNITION_CAPACITY,
  ARMOR_CAPACITY,
  vehicleRepairQuote
} from '../shared/content/street-services.ts';
import {StreetEconomyController} from '../server/game/economy/street-economy-controller.ts';
import {GameEventStream} from '../server/game/events/game-events.ts';
import {StreetServiceController} from '../server/game/services/street-service-controller.ts';
import {DistrictState, PlayerState, VehicleState} from '../server/state.ts';
import {refillAmmo} from '../server/weapons.ts';
import {
  VEHICLE_NEON_INSTALL_PRICE,
  VEHICLE_NEON_RECOLOR_PRICE
} from '../shared/content/vehicle-neon.ts';
import {
  STOREFRONT_PROTOCOL_VERSION,
  type StorefrontPurchaseMessage,
  type StorefrontSnapshot
} from '../shared/protocol/storefront.ts';
import {CollisionMap} from '../server/world-map.ts';
import {
  STREET_SPACE_ID,
  containsPoint,
  interiorDefinition
} from '../shared/content/interior-catalog.ts';

test('street services initialize once at collision-safe authoritative locations', () => {
  const fixture = createFixture();
  fixture.services.initialize();
  fixture.services.initialize();

  assert.equal(fixture.state.services.size, 3);
  assert.deepEqual([...fixture.state.services.values()].map((service) => service.id).sort(), [
    'ammunition-counter',
    'clothing-store',
    'repair-garage'
  ]);
  for (const service of fixture.state.services.values()) {
    const interior = interiorDefinition(service.spaceId);
    if (!interior) {
      assert.equal(service.spaceId, STREET_SPACE_ID);
      assert.equal(fixture.world.canOccupy(service.x, service.y, 11), true);
      continue;
    }
    assert.equal(containsPoint(interior.bounds, service.x, service.y), true);
    assert.equal(
      interior.obstacles.some((obstacle) => containsPoint(obstacle, service.x, service.y)),
      false
    );
  }
  assert.equal(fixture.state.services.get('ammunition-counter')?.spaceId, 'ammunation-store');
  assert.equal(fixture.state.services.get('clothing-store')?.spaceId, 'threads-store');
  const clothing = fixture.state.services.get('clothing-store');
  assert.ok(clothing);
});

test('repair garage opens a storefront without charging, then atomically repairs', () => {
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
  assert.equal(fixture.player.cash, 1000);
  assert.equal(vehicle.health, 700);
  assert.equal(fixture.storefrontOpens.length, 1);
  assert.equal(fixture.storefrontOpens[0]?.snapshot.products[0]?.price, quote);

  const result = fixture.services.purchase(
    fixture.player.id,
    purchase(fixture.storefrontOpens[0]!.snapshot, 1, 'repair.full'),
    1001
  );
  assert.equal(result.status, 'applied');
  assert.equal(fixture.player.cash, 1000 - quote);
  assert.equal(vehicle.health, vehicle.maxHealth);
  assert.equal(vehicle.engineDamage, 0);
  assert.equal(vehicle.damageFront, 0);
  assert.equal(fixture.repairCount(), 1);
  assert.equal(fixture.notices.at(-1)?.message, `Vehicle repaired -$${quote}`);
  assert.equal(fixture.economy.size, 1);
});

test('repair garage installs an explicitly selected neon color and can remove it', () => {
  const fixture = createFixture();
  fixture.services.initialize();
  fixture.player.cash = 1000;
  const garage = fixture.state.services.get('repair-garage');
  assert.ok(garage);
  const vehicle = new VehicleState();
  vehicle.id = 'custom-car';
  vehicle.x = garage.x;
  vehicle.y = garage.y;
  vehicle.driverId = fixture.player.id;
  fixture.state.vehicles.set(vehicle.id, vehicle);
  fixture.player.vehicleId = vehicle.id;
  fixture.player.vehicleSeat = 0;

  assert.equal(fixture.services.interact(fixture.player.id, 1500), true);
  const snapshot = fixture.storefrontOpens[0]?.snapshot;
  assert.ok(snapshot);
  assert.equal(vehicle.neonColor, 'off');
  assert.equal(
    fixture.services.purchase(
      fixture.player.id,
      purchase(snapshot, 1, 'neon.violet'),
      1501
    ).status,
    'applied'
  );
  assert.equal(vehicle.neonColor, 'violet');
  assert.equal(fixture.player.cash, 1000 - VEHICLE_NEON_INSTALL_PRICE);
  assert.equal(fixture.notices.at(-1)?.message, 'VIOLET neon installed -$350');

  fixture.setTick(18);
  assert.equal(
    fixture.services.purchase(
      fixture.player.id,
      purchase(snapshot, 2, 'neon.amber'),
      1600
    ).status,
    'applied'
  );
  assert.equal(vehicle.neonColor, 'amber');
  assert.equal(
    fixture.player.cash,
    1000 - VEHICLE_NEON_INSTALL_PRICE - VEHICLE_NEON_RECOLOR_PRICE
  );
  assert.equal(fixture.notices.at(-1)?.message, 'AMBER neon installed -$75');

  assert.equal(
    fixture.services.purchase(
      fixture.player.id,
      purchase(snapshot, 3, 'neon.off'),
      1601
    ).status,
    'applied'
  );
  assert.equal(vehicle.neonColor, 'off');
  assert.equal(fixture.economy.size, 2);
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

test('combat supply atomically charges for ammunition and armor', () => {
  const fixture = createFixture();
  fixture.services.initialize();
  fixture.player.cash = 1000;
  fixture.player.armor = 0;
  fixture.player.ammoPistol = 0;
  fixture.player.ammoSmg = 40;
  fixture.player.ammoShotgun = 8;
  fixture.player.magazinePistol = 0;
  fixture.player.magazineSmg = 0;
  fixture.player.magazineShotgun = 0;
  const counter = fixture.state.services.get('ammunition-counter');
  assert.ok(counter);
  fixture.player.x = counter.x;
  fixture.player.y = counter.y;
  fixture.player.spaceId = counter.spaceId;

  assert.equal(fixture.services.interact(fixture.player.id, 3000), true);
  assert.equal(fixture.player.cash, 504);
  assert.equal(fixture.player.ammoPistol, 108);
  assert.equal(fixture.player.ammoSmg, 210);
  assert.equal(fixture.player.ammoShotgun, 42);
  assert.equal(fixture.player.magazinePistol, 12);
  assert.equal(fixture.player.magazineSmg, 30);
  assert.equal(fixture.player.magazineShotgun, 6);
  assert.equal(fixture.player.ammoGrenade, AMMUNITION_CAPACITY.ammoGrenade);
  assert.equal(fixture.player.ammoMolotov, AMMUNITION_CAPACITY.ammoMolotov);
  assert.equal(fixture.player.armor, ARMOR_CAPACITY);
  assert.equal(fixture.restockCount(), 1);
  assert.equal(fixture.notices.at(-1)?.message, 'Combat resupply -$496');
});

test('clothing store opens only for an on-foot heat-free player without changing cash', () => {
  const fixture = createFixture();
  fixture.services.initialize();
  const store = fixture.state.services.get('clothing-store');
  assert.ok(store);
  fixture.player.x = store.x;
  fixture.player.y = store.y;
  fixture.player.spaceId = store.spaceId;
  fixture.player.cash = 400;

  assert.equal(fixture.services.interact(fixture.player.id, 4000), true);
  assert.deepEqual(fixture.wardrobeOpens, [{playerId: fixture.player.id, serviceId: store.id}]);
  assert.equal(fixture.player.cash, 400);

  fixture.player.wanted = 1;
  assert.equal(fixture.services.interact(fixture.player.id, 4001), true);
  assert.equal(fixture.wardrobeOpens.length, 1);
  assert.match(fixture.notices.at(-1)?.message ?? '', /Lose police heat/);

  fixture.player.wanted = 0;
  fixture.player.vehicleId = 'car';
  assert.equal(fixture.services.interact(fixture.player.id, 4002), false);
});

test('street services never cross space boundaries even when coordinates overlap', () => {
  const fixture = createFixture();
  fixture.services.initialize();
  const store = fixture.state.services.get('clothing-store');
  assert.ok(store);
  fixture.player.x = store.x;
  fixture.player.y = store.y;

  fixture.player.spaceId = 'mercy-hospital';
  assert.equal(fixture.services.interact(fixture.player.id, 5000), false);
  assert.equal(fixture.wardrobeOpens.length, 0);

  fixture.player.spaceId = store.spaceId;
  assert.equal(fixture.services.interact(fixture.player.id, 5001), true);
  assert.equal(fixture.wardrobeOpens.length, 1);
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
  const wardrobeOpens: Array<{playerId: string; serviceId: string}> = [];
  const storefrontOpens: Array<{playerId: string; snapshot: StorefrontSnapshot}> = [];
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
      refillAmmo(target);
      target.armor = ARMOR_CAPACITY;
    },
    medical: {
      canTreat: () => false,
      treat: () => false
    },
    openWardrobe: (playerId, serviceId) => wardrobeOpens.push({playerId, serviceId}),
    openStorefront: (playerId, snapshot) => storefrontOpens.push({playerId, snapshot}),
    notice: (playerId, message, tone) => notices.push({playerId, message, tone})
  });
  return {
    state,
    world,
    player,
    economy,
    services,
    notices,
    wardrobeOpens,
    storefrontOpens,
    repairCount: () => repairs,
    restockCount: () => restocks,
    setTick: (value: number) => { tick = value; }
  };
}

function purchase(
  snapshot: StorefrontSnapshot,
  sequence: number,
  productId: StorefrontPurchaseMessage['productId']
): StorefrontPurchaseMessage {
  return {
    protocolVersion: STOREFRONT_PROTOCOL_VERSION,
    sequence,
    storeId: snapshot.storeId,
    vehicleId: snapshot.vehicle.id,
    productId
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
