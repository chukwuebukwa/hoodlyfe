import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SEAMLESS_INTERIORS,
  SEAMLESS_ROOF_EXIT_MARGIN,
  blocksSeamlessInterior,
  replacesSeamlessWorldCollision,
  seamlessInteriorAt
} from '../shared/content/seamless-interior-catalog.ts';
import {CollisionMap} from '../server/world-map.ts';
import {ClientCollisionMap} from '../src/game/world/client-collision-map.ts';
import {vehicleDefinition} from '../shared/content/vehicle-catalog.ts';

const store = SEAMLESS_INTERIORS[0];
const garage = SEAMLESS_INTERIORS.find(({id}) => id === 'nock-auto-garage');
const quickMart = SEAMLESS_INTERIORS.find(({id}) => id === 'eastside-quick-mart');
const westsideGarage = SEAMLESS_INTERIORS.find(({id}) => id === 'westside-auto-garage');

test('seamless roof visibility enters immediately and exits with hysteresis', () => {
  assert.ok(store);
  const inside = seamlessInteriorAt(12_768, 8_100);
  assert.equal(inside?.id, store.id);
  assert.equal(seamlessInteriorAt(12_590, 8_150)?.id, store.id);
  assert.equal(seamlessInteriorAt(
    store.entrance.x,
    store.revealAreas[1].maxY + SEAMLESS_ROOF_EXIT_MARGIN - 1,
    store.id
  )?.id, store.id);
  assert.equal(seamlessInteriorAt(
    store.entrance.x,
    store.revealAreas[1].maxY + SEAMLESS_ROOF_EXIT_MARGIN + 1,
    store.id
  ), undefined);
});

test('seamless garage keeps a vehicle-width entrance and open service bays', () => {
  assert.ok(garage);
  assert.equal(blocksSeamlessInterior(garage.entrance.x, garage.entrance.y, 28, 'vehicle'), false);
  assert.equal(blocksSeamlessInterior(garage.entrance.x - 110, garage.entrance.y, 28, 'vehicle'), true);
  const service = garage.serviceBindings[0];
  assert.ok(service);
  assert.equal(blocksSeamlessInterior(service.x, service.y, 28, 'vehicle'), false);
});

test('authoritative collision keeps the garage road-to-repair path open for cars', () => {
  assert.ok(garage);
  const world = CollisionMap.load();
  const radius = vehicleDefinition('sedan').radius;
  assert.equal(
    world.canOccupy(garage.entrance.x, garage.entrance.y, radius, undefined, 'vehicle'),
    false
  );
  world.setGarageDoorPassable(garage.id, true);
  for (let y = garage.entrance.y + 52; y >= garage.serviceBindings[0]!.y - 38; y -= 20) {
    assert.equal(
      world.canOccupy(garage.entrance.x, y, radius, undefined, 'vehicle'),
      true,
      `garage vehicle corridor is blocked at y=${y}`
    );
  }
});

test('shared geometry blocks walls and fixtures but leaves the entrance open', () => {
  assert.equal(blocksSeamlessInterior(12_857, 8_100, 11), true);
  assert.equal(blocksSeamlessInterior(12_720, 8_080, 11), true);
  assert.equal(blocksSeamlessInterior(12_487, 8_096, 11), true);
  assert.equal(blocksSeamlessInterior(store.entrance.x, store.entrance.y, 11), false);
  assert.equal(blocksSeamlessInterior(12_768, 8_200, 11), false);
  assert.equal(blocksSeamlessInterior(12_590, 8_150, 11), false);
  assert.equal(blocksSeamlessInterior(12_672, 8_150, 11), false);
  for (let y = store.bounds.maxY + 24; y >= store.bounds.minY + 128; y -= 8) {
    assert.equal(
      blocksSeamlessInterior(store.entrance.x, y, 11),
      false,
      `entrance corridor is blocked at y=${y}`
    );
  }
  assert.equal(replacesSeamlessWorldCollision(12_768, 8_100), true);
  assert.equal(replacesSeamlessWorldCollision(12_590, 8_150), true);
  assert.equal(replacesSeamlessWorldCollision(12_768, 8_340), true);
});

test('Eastside Quick Mart seals its shell while keeping the south entrance open', () => {
  assert.ok(quickMart);
  assert.equal(quickMart.roofTriangleCount, 164);
  assert.equal(blocksSeamlessInterior(quickMart.entrance.x, quickMart.entrance.y, 11), false);
  assert.equal(blocksSeamlessInterior(quickMart.bounds.minX + 4, quickMart.entrance.y - 8, 11), true);
  assert.equal(blocksSeamlessInterior(quickMart.bounds.maxX - 4, quickMart.bounds.minY + 64, 11), true);
  assert.equal(blocksSeamlessInterior(quickMart.bounds.minX + 96, quickMart.bounds.minY + 4, 11), true);
  assert.equal(blocksSeamlessInterior(10_592, 8_608, 11), true);
  assert.equal(blocksSeamlessInterior(10_500, 8_650, 11), false);

  const world = CollisionMap.load();
  for (let y = quickMart.entrance.y + 20; y >= quickMart.entrance.y - 72; y -= 8) {
    assert.equal(
      world.canOccupy(quickMart.entrance.x, y, 11, 'street-ground', 'player'),
      true,
      `Quick Mart entrance corridor is blocked at y=${y}`
    );
  }
});

test('Westside Auto keeps its west entrance and L-shaped repair route open', () => {
  assert.ok(westsideGarage);
  const radius = vehicleDefinition('sedan').radius;
  assert.equal(
    blocksSeamlessInterior(
      westsideGarage.entrance.x,
      westsideGarage.entrance.y,
      radius,
      'vehicle'
    ),
    false
  );
  const service = westsideGarage.serviceBindings[0];
  assert.ok(service);
  assert.equal(blocksSeamlessInterior(service.x, service.y, radius, 'vehicle'), false);

  const world = CollisionMap.load();
  assert.equal(
    world.canOccupy(
      westsideGarage.entrance.x,
      westsideGarage.entrance.y,
      radius,
      'street-ground',
      'vehicle'
    ),
    false
  );
  world.setGarageDoorPassable(westsideGarage.id, true);
  const route = [
    [westsideGarage.entrance.x - 20, westsideGarage.entrance.y],
    [westsideGarage.entrance.x + 40, westsideGarage.entrance.y],
    [westsideGarage.entrance.x + 100, westsideGarage.entrance.y],
    [westsideGarage.entrance.x + 100, service.y],
    [westsideGarage.entrance.x + 180, service.y],
    [westsideGarage.entrance.x + 280, service.y],
    [service.x, service.y]
  ] as const;
  for (const [x, y] of route) {
    assert.equal(
      world.canOccupy(x, y, radius, 'street-ground', 'vehicle'),
      true,
      `Westside Auto repair route is blocked at ${x},${y}`
    );
  }
});

test('server and browser collision agree on the seamless store', () => {
  const server = CollisionMap.load();
  const client = new ClientCollisionMap({
    width: server.width,
    height: server.height,
    tilewidth: server.tileWidth,
    tileheight: server.tileHeight,
    layers: [{
      name: 'collisions',
      data: [...server.physicsGeometry().collisions]
    }]
  });
  for (const [x, y, expected] of [
    [12_857, 8_100, false],
    [12_720, 8_080, false],
    [12_487, 8_096, false],
    [store.entrance.x, store.entrance.y, true],
    [12_768, 8_200, true],
    [12_590, 8_150, true],
    [12_672, 8_150, true]
  ] as const) {
    assert.equal(server.canOccupy(x, y, 11, 'street-ground', 'player'), expected);
    assert.equal(client.canOccupy('street', x, y, 11), expected);
  }
  assert.equal(
    (server.physicsGeometry().staticRects ?? []).length,
    SEAMLESS_INTERIORS.reduce((total, interior) => total + interior.obstacles.length, 0)
  );
  assert.equal(
    (server.physicsGeometry().collisionExclusions ?? []).length,
    SEAMLESS_INTERIORS.reduce((total, interior) => (
      total + interior.footprints.length + interior.floorConnectors.length + 1
    ), 0)
  );
  assert.ok(garage?.garageDoor);
  assert.equal(
    server.canOccupy(garage.garageDoor.x, garage.garageDoor.y, 11, 'street-ground', 'player'),
    false
  );
  assert.equal(client.canOccupy('street', garage.garageDoor.x, garage.garageDoor.y, 11), false);
  server.setGarageDoorPassable(garage.id, true);
  client.setGarageDoorPassable(garage.id, true);
  assert.equal(
    server.canOccupy(garage.garageDoor.x, garage.garageDoor.y, 11, 'street-ground', 'player'),
    true
  );
  assert.equal(client.canOccupy('street', garage.garageDoor.x, garage.garageDoor.y, 11), true);
});
