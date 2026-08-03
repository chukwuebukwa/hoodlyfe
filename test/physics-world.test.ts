import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {test, before} from 'node:test';
import {
  PhysicsWorld,
  initializePhysicsEngine,
  type PhysicsBodyState,
  type PhysicsWorldGeometry
} from '../shared/physics/physics-world.ts';

interface TiledMapData {
  width: number;
  height: number;
  tilewidth: number;
  tileheight: number;
  layers: Array<{name: string; data: number[]}>;
}

function districtGeometry(): PhysicsWorldGeometry {
  const map = JSON.parse(
    readFileSync(resolve('public', 'assets', 'maps', 'district-map.json'), 'utf8')
  ) as TiledMapData;
  const collisions = map.layers.find((layer) => layer.name === 'collisions');
  assert.ok(collisions, 'district map must have a collisions layer');
  return {
    width: map.width,
    height: map.height,
    tileWidth: map.tilewidth,
    tileHeight: map.tileheight,
    collisions: collisions.data
  };
}

function spawnState(x: number, y: number, overrides: Partial<PhysicsBodyState> = {}): PhysicsBodyState {
  return {x, y, rotation: 0, linvelX: 0, linvelY: 0, angvel: 0, ...overrides};
}

function buildPopulatedWorld(geometry: PhysicsWorldGeometry): PhysicsWorld {
  const world = PhysicsWorld.create(geometry);
  world.registerVehicle('vehicle:a', 'sedan', spawnState(600, 600, {linvelX: 180}));
  world.registerVehicle('vehicle:b', 'police', spawnState(760, 600, {linvelX: -140}));
  world.registerHumanoid('player:p1', 11, spawnState(680, 640, {linvelY: -80}));
  world.registerHumanoid('npc:n1', 10, spawnState(700, 560, {linvelY: 60}));
  return world;
}

function scriptVelocities(world: PhysicsWorld, tick: number): void {
  const phase = tick * 0.13;
  world.setVelocity('vehicle:a', Math.cos(phase) * 200, Math.sin(phase * 0.6) * 120, 0.2);
}

before(async () => {
  await initializePhysicsEngine();
});

test('district meshing produces a bounded static collider set', () => {
  const geometry = districtGeometry();
  const world = PhysicsWorld.create(geometry);
  const rebuilt = PhysicsWorld.create(geometry);
  assert.ok(world.staticColliderCount > 4, 'meshing must produce colliders beyond border walls');
  assert.ok(world.staticColliderCount < 2000, 'greedy merge must compact the tile grid');
  assert.equal(world.staticColliderCount, rebuilt.staticColliderCount);
  world.free();
  rebuilt.free();
});

test('authored world rectangles become deterministic static colliders', () => {
  const geometry: PhysicsWorldGeometry = {
    width: 4,
    height: 4,
    tileWidth: 64,
    tileHeight: 64,
    collisions: new Array(16).fill(0),
    staticRects: [{minX: 120, minY: 64, maxX: 136, maxY: 192}]
  };
  const world = PhysicsWorld.create(geometry);
  const rebuilt = PhysicsWorld.create(geometry);
  assert.equal(world.staticColliderCount, 5);
  assert.equal(rebuilt.staticColliderCount, world.staticColliderCount);
  world.registerHumanoid('player:test', 11, spawnState(80, 128));
  for (let tick = 0; tick < 60; tick++) {
    world.setVelocity('player:test', 160, 0, 0);
    world.step();
  }
  const state = world.capture('player:test');
  assert.ok(state);
  assert.ok(state.x <= 109.5, `body crossed authored wall at x=${state.x}`);
  world.free();
  rebuilt.free();
});

test('controlled static colliders block while closed and release without reallocating actors', () => {
  const geometry: PhysicsWorldGeometry = {
    width: 4,
    height: 4,
    tileWidth: 64,
    tileHeight: 64,
    collisions: new Array(16).fill(0),
    controlledStaticRects: [{
      id: 'garage',
      minX: 120,
      minY: 64,
      maxX: 136,
      maxY: 192
    }]
  };
  const world = PhysicsWorld.create(geometry);
  assert.equal(world.staticColliderCount, 5);
  world.registerHumanoid('player:test', 11, spawnState(80, 128));
  const identity = world.bodyIdentity('player:test');
  for (let tick = 0; tick < 60; tick++) {
    world.setVelocity('player:test', 160, 0, 0);
    world.step();
  }
  assert.ok(world.capture('player:test')!.x <= 109.5);

  world.setControlledStaticEnabled('garage', false);
  world.teleport('player:test', spawnState(80, 128));
  for (let tick = 0; tick < 60; tick++) {
    world.setVelocity('player:test', 160, 0, 0);
    world.step();
  }
  assert.ok(world.capture('player:test')!.x > 136);
  assert.equal(world.bodyIdentity('player:test'), identity);
  world.free();
});

test('identically built and driven worlds stay bit-identical', () => {
  const geometry = districtGeometry();
  const first = buildPopulatedWorld(geometry);
  const second = buildPopulatedWorld(geometry);
  for (let tick = 0; tick < 120; tick++) {
    scriptVelocities(first, tick);
    scriptVelocities(second, tick);
    first.step();
    second.step();
  }
  const firstStates = first.captureAll();
  const secondStates = second.captureAll();
  assert.equal(firstStates.size, secondStates.size);
  for (const [key, state] of firstStates) {
    const other = secondStates.get(key);
    assert.ok(other, `missing body ${key}`);
    for (const field of ['x', 'y', 'rotation', 'linvelX', 'linvelY', 'angvel'] as const) {
      assert.ok(
        Object.is(state[field], other[field]),
        `${key}.${field} diverged: ${state[field]} vs ${other[field]}`
      );
    }
  }
  first.free();
  second.free();
});

test('writeback replay reproduces the live timeline within correction tolerance', () => {
  const geometry = districtGeometry();
  const world = buildPopulatedWorld(geometry);
  for (let tick = 0; tick < 30; tick++) {
    scriptVelocities(world, tick);
    world.step();
  }
  const saved = world.captureAll();
  for (let tick = 30; tick < 36; tick++) {
    scriptVelocities(world, tick);
    world.step();
  }
  const expected = world.captureAll();

  world.writebackAll(saved);
  for (let tick = 30; tick < 36; tick++) {
    scriptVelocities(world, tick);
    world.step();
  }
  for (const [key, state] of world.captureAll()) {
    const reference = expected.get(key);
    assert.ok(reference, `missing reference for ${key}`);
    const positionError = Math.hypot(state.x - reference.x, state.y - reference.y);
    assert.ok(
      positionError < 1,
      `${key} writeback divergence ${positionError}px exceeds correction tolerance`
    );
  }
  world.free();
});

test('driven vehicles stay inside the meshed district', () => {
  const geometry = districtGeometry();
  const world = PhysicsWorld.create(geometry);
  world.registerVehicle('vehicle:runaway', 'sedan', spawnState(600, 600));
  const worldWidth = geometry.width * geometry.tileWidth;
  const worldHeight = geometry.height * geometry.tileHeight;
  for (let tick = 0; tick < 300; tick++) {
    world.setVelocity('vehicle:runaway', 500, 170, 0);
    world.step();
  }
  const state = world.capture('vehicle:runaway');
  assert.ok(state);
  assert.ok(state.x > -geometry.tileWidth && state.x < worldWidth + geometry.tileWidth);
  assert.ok(state.y > -geometry.tileHeight && state.y < worldHeight + geometry.tileHeight);
  world.free();
});

test('bodies can be removed and re-registered without corrupting the world', () => {
  const geometry = districtGeometry();
  const world = buildPopulatedWorld(geometry);
  world.remove('vehicle:b');
  assert.equal(world.has('vehicle:b'), false);
  assert.equal(world.capture('vehicle:b'), undefined);
  world.step();
  world.registerVehicle('vehicle:b', 'taxi', spawnState(900, 900));
  assert.equal(world.has('vehicle:b'), true);
  world.step();
  assert.ok(world.capture('vehicle:b'));
  assert.throws(() => world.registerVehicle('vehicle:b', 'taxi', spawnState(0, 0)));
  world.free();
});

test('forked worlds keep elevation partitions physically isolated', () => {
  const root = PhysicsWorld.create(districtGeometry());
  const elevated = root.fork();
  root.registerHumanoid('player:ground', 10, spawnState(600, 600));
  elevated.registerHumanoid('player:elevated', 10, spawnState(600, 600));
  root.step();
  elevated.step();
  assert.deepEqual(root.contacts(), []);
  assert.deepEqual(elevated.contacts(), []);
  assert.equal(root.has('player:elevated'), false);
  assert.equal(elevated.has('player:ground'), false);
  root.free();
});

test('world-offset surface geometry collides in authoritative world coordinates', () => {
  const root = PhysicsWorld.create(districtGeometry());
  const surface = root.fork(true, {
    width: 4,
    height: 2,
    tileWidth: 32,
    tileHeight: 32,
    originX: 1_000,
    originY: 2_000,
    collisions: [
      1, 0, 0, 1,
      1, 0, 0, 1
    ]
  });
  surface.registerHumanoid('player:offset', 8, spawnState(1_080, 2_048));
  for (let tick = 0; tick < 60; tick++) {
    surface.setVelocity('player:offset', -120, 0, 0);
    surface.step();
  }
  const state = surface.capture('player:offset');
  assert.ok(state);
  assert.ok(state.x >= 1_039, `offset collider failed to stop body at x=${state.x}`);
  root.free();
});

test('authored surface barriers stop bodies without sealing exposed deck cells', () => {
  const openGeometry: PhysicsWorldGeometry = {
    width: 8,
    height: 8,
    tileWidth: 32,
    tileHeight: 32,
    encloseBorders: false,
    collisions: new Array(64).fill(0)
  };
  const open = PhysicsWorld.create(openGeometry);
  const guarded = PhysicsWorld.create({
    ...openGeometry,
    barriers: [{
      from: {x: 128, y: 32},
      to: {x: 128, y: 224},
      thickness: 3
    }]
  });
  open.registerHumanoid('player:open', 8, spawnState(96, 128));
  guarded.registerHumanoid('player:guarded', 8, spawnState(96, 128));

  for (let tick = 0; tick < 45; tick++) {
    open.setVelocity('player:open', 180, 0, 0);
    guarded.setVelocity('player:guarded', 180, 0, 0);
    open.step();
    guarded.step();
  }

  const openState = open.capture('player:open');
  const guardedState = guarded.capture('player:guarded');
  assert.ok(openState);
  assert.ok(guardedState);
  assert.ok(openState.x > 160, `unbarred body unexpectedly stopped at x=${openState.x}`);
  assert.ok(guardedState.x < 121, `barrier failed to stop body at x=${guardedState.x}`);
  open.free();
  guarded.free();
});
