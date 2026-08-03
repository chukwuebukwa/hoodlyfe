import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import test from 'node:test';
import {CollisionMap} from '../server/world-map.ts';
import {SurfaceMap, type SurfaceManifest} from '../shared/world/surface-map.ts';

const hasLocalAssets = existsSync(resolve('public/assets/maps/district-map.json'));

test('generated district exposes a safe spawn and collision boundary', {skip: !hasLocalAssets}, () => {
  const world = CollisionMap.load();
  const playerSpawn = world.spawnFor(0, 11);
  assert.equal(world.canOccupy(playerSpawn.x, playerSpawn.y, 11, playerSpawn.surfaceId), true);
  assert.equal(world.isBlockedAt(-1, -1), true);
  assert.equal(world.hasLineOfSight(world.spawn.x, world.spawn.y, world.spawn.x, world.spawn.y), true);

  const nearby = world.openPointNear(world.spawn.x, world.spawn.y, 80, 320, 11, 42);
  assert.equal(world.canOccupy(nearby.x, nearby.y, 11, nearby.surfaceId), true);

  const traffic = world.trafficSpawn(12, 20);
  assert.equal(world.isRoadAt(traffic.x, traffic.y), true);
  assert.equal(world.canOccupy(traffic.x, traffic.y, 20, traffic.surfaceId, 'vehicle'), true);
  assert.ok(world.roadNeighbors(traffic.column, traffic.row).length > 0);
  const nearestRoad = world.nearestRoadNode(world.spawn.x, world.spawn.y, 20);
  assert.ok(nearestRoad);
  const nearestRoadPoint = world.roadPoint(nearestRoad);
  assert.equal(world.isRoadAt(nearestRoadPoint.x, nearestRoadPoint.y), true);
  assert.ok(world.surfaces.surfaceIdsAt(nearestRoadPoint.x, nearestRoadPoint.y, 'vehicle').length > 0);

  for (const row of [36, 40, 44, 48]) {
    assert.ok(world.surfaces.surfaceIdsAt(
      27.5 * world.tileWidth,
      (row + 0.5) * world.tileHeight,
      'player'
    ).length > 0);
  }
});

test('traffic spawns normalize fractional and non-finite deterministic seeds', {skip: !hasLocalAssets}, () => {
  const world = CollisionMap.load();
  for (const seed of [123.75, Number.NaN, Number.POSITIVE_INFINITY]) {
    const spawn = world.trafficSpawn(seed, 20);
    assert.equal(Number.isFinite(spawn.x), true);
    assert.equal(Number.isFinite(spawn.y), true);
    assert.equal(world.canOccupy(spawn.x, spawn.y, 20, spawn.surfaceId, 'vehicle'), true);
    assert.equal(world.isRoadAt(spawn.x, spawn.y), true);
  }
});

test('nearest road lookup rejects farther cells before resolving their surfaces', {
  skip: !hasLocalAssets
}, () => {
  const world = CollisionMap.load();
  const surfaceIdsAt = world.surfaces.surfaceIdsAt.bind(world.surfaces);
  let surfaceLookups = 0;
  world.surfaces.surfaceIdsAt = (...args) => {
    surfaceLookups++;
    return surfaceIdsAt(...args);
  };

  const nearest = world.nearestRoadNode(5216, 6048, 20);
  assert.equal(nearest?.column, 81);
  assert.equal(nearest?.row, 94);
  assert.ok(nearest?.surfaceId);
  assert.equal(world.heightAt(nearest.surfaceId, 5216, 6048), 128);
  assert.ok(surfaceLookups < 1_000, `${surfaceLookups} surface lookups`);
});

test('authored surfaces preserve default transitions and ignore blockers on another elevation', () => {
  const manifest = layeredFixture();
  const world = new CollisionMap({
    width: 2,
    height: 1,
    tilewidth: 64,
    tileheight: 64,
    layers: [
      {name: 'collisions', data: [1, 1]},
      {name: 'roads', data: [1, 1]}
    ]
  }, {
    spawn: {x: 32, y: 32}
  }, new SurfaceMap(manifest));

  assert.deepEqual(world.surfaces.neighbors('street-ground', 'player'), ['bridge-ramp']);
  assert.equal(world.canOccupy(32, 32, 8, 'street-ground'), true);
  assert.equal(world.canOccupy(96, 32, 8, 'bridge-deck', 'vehicle'), true);
  assert.equal(
    world.surfaceAfterMove('street-ground', 56, 32, 72, 32, 0, 'player'),
    'bridge-ramp'
  );
});

test('world map detects an exposed elevated edge and selects the lower landing sheet', () => {
  const actorKinds = ['player', 'pedestrian', 'vehicle', 'projectile', 'prop'] as const;
  const world = new CollisionMap({
    width: 4,
    height: 2,
    tilewidth: 64,
    tileheight: 64,
    layers: [
      {name: 'collisions', data: new Array(8).fill(0)},
      {name: 'roads', data: new Array(8).fill(1)}
    ]
  }, {
    spawn: {x: 32, y: 32}
  }, new SurfaceMap({
    version: 1,
    collisionRevision: 2,
    blockSize: 64,
    defaultSurfaceId: 'street-ground',
    surfaces: [
      rectangle('street-ground', 0, 0, 256, 128, 0, actorKinds),
      rectangle('bridge-deck', 0, 0, 128, 128, 128, actorKinds)
    ],
    transitions: []
  }));

  assert.deepEqual(
    world.dropTargetAfterMove('bridge-deck', 112, 64, 136, 64, 11, 'player'),
    {surfaceId: 'street-ground', height: 0}
  );
  assert.equal(
    world.dropTargetAfterMove('street-ground', 112, 64, 136, 64, 11, 'player'),
    undefined,
    'The lowest surface cannot launch an actor into empty space.'
  );
});

test('world map looks beyond a straddling footprint for an exposed-edge landing', () => {
  const actorKinds = ['player', 'pedestrian', 'vehicle', 'projectile', 'prop'] as const;
  const world = new CollisionMap({
    width: 4,
    height: 2,
    tilewidth: 64,
    tileheight: 64,
    layers: [
      {name: 'collisions', data: new Array(8).fill(0)},
      {name: 'roads', data: new Array(8).fill(1)}
    ]
  }, {
    spawn: {x: 32, y: 32}
  }, new SurfaceMap({
    version: 1,
    collisionRevision: 2,
    blockSize: 64,
    defaultSurfaceId: 'street-ground',
    surfaces: [
      rectangle('street-ground', 128, 0, 256, 128, 0, actorKinds),
      rectangle('bridge-deck', 0, 0, 128, 128, 128, actorKinds)
    ],
    transitions: []
  }));

  assert.deepEqual(
    world.dropTargetAfterMove('bridge-deck', 108, 64, 120, 64, 20, 'vehicle'),
    {surfaceId: 'street-ground', height: 0}
  );
});

test('surface physics geometry is world-offset, bounded, and opens transition gateways', () => {
  const world = new CollisionMap({
    width: 2,
    height: 1,
    tilewidth: 64,
    tileheight: 64,
    layers: [
      {name: 'collisions', data: [0, 0]},
      {name: 'roads', data: [1, 1]}
    ]
  }, {
    spawn: {x: 32, y: 32}
  }, new SurfaceMap(layeredFixture()));

  const geometry = world.physicsGeometry('bridge-ramp');
  assert.ok((geometry.originX ?? 0) > 0);
  assert.ok((geometry.originY ?? 0) < 0);
  assert.ok(geometry.collisions.includes(0), 'surface interior must remain traversable');
  assert.equal(geometry.encloseBorders, false, 'transitions must not be sealed by an outer wall');
  assert.equal(world.physicsGeometry('bridge-ramp'), geometry, 'surface geometry must be cached');
});

test('surface physics opens fallable side faces but preserves internal barriers', () => {
  const actorKinds = ['player', 'pedestrian', 'vehicle', 'projectile', 'prop'] as const;
  const openWorld = new CollisionMap({
    width: 4,
    height: 2,
    tilewidth: 64,
    tileheight: 64,
    layers: [
      {name: 'collisions', data: new Array(8).fill(0)},
      {name: 'roads', data: new Array(8).fill(1)}
    ]
  }, {
    spawn: {x: 32, y: 32}
  }, new SurfaceMap({
    version: 1,
    collisionRevision: 2,
    blockSize: 64,
    defaultSurfaceId: 'street-ground',
    surfaces: [
      rectangle('street-ground', 0, 0, 256, 128, 0, actorKinds),
      rectangle('bridge-deck', 0, 0, 128, 128, 128, actorKinds)
    ],
    transitions: []
  }));
  const legacyBlockedWorld = new CollisionMap({
    width: 4,
    height: 2,
    tilewidth: 64,
    tileheight: 64,
    layers: [
      {name: 'collisions', data: [0, 0, 1, 0, 0, 0, 1, 0]},
      {name: 'roads', data: new Array(8).fill(1)}
    ]
  }, {
    spawn: {x: 32, y: 32}
  }, openWorld.surfaces);
  const barrierDeck = {
    ...rectangle('bridge-deck', 0, 0, 128, 128, 128, actorKinds),
    barriers: [
      {from: {x: 128, y: 0}, to: {x: 128, y: 128}},
      {from: {x: 64, y: 0}, to: {x: 64, y: 128}}
    ]
  };
  const barrierWorld = new CollisionMap({
    width: 4,
    height: 2,
    tilewidth: 64,
    tileheight: 64,
    layers: [
      {name: 'collisions', data: new Array(8).fill(0)},
      {name: 'roads', data: new Array(8).fill(1)}
    ]
  }, {
    spawn: {x: 32, y: 32}
  }, new SurfaceMap({
    version: 1,
    collisionRevision: 2,
    blockSize: 64,
    defaultSurfaceId: 'street-ground',
    surfaces: [
      rectangle('street-ground', 0, 0, 256, 128, 0, actorKinds),
      barrierDeck
    ],
    transitions: []
  }));

  assert.equal(physicsCellAt(openWorld.physicsGeometry('bridge-deck'), 144, 64), 0);
  assert.equal(
    physicsCellAt(legacyBlockedWorld.physicsGeometry('bridge-deck'), 144, 64),
    0,
    'flattened blockers must not seal an elevated edge'
  );
  assert.deepEqual(barrierWorld.physicsGeometry('bridge-deck').barriers, [{
    from: {x: 64, y: 0},
    to: {x: 64, y: 128},
    thickness: 4
  }], 'only the wall between same-level floor samples should remain solid');
});

test('surface physics recognizes a GTA2 side face inset from the deck edge', () => {
  const actorKinds = ['player', 'pedestrian', 'vehicle', 'projectile', 'prop'] as const;
  const world = new CollisionMap({
    width: 4,
    height: 2,
    tilewidth: 64,
    tileheight: 64,
    layers: [
      {name: 'collisions', data: new Array(8).fill(0)},
      {name: 'roads', data: new Array(8).fill(1)}
    ]
  }, {
    spawn: {x: 32, y: 32}
  }, new SurfaceMap({
    version: 1,
    collisionRevision: 2,
    blockSize: 64,
    defaultSurfaceId: 'street-ground',
    surfaces: [
      rectangle('street-ground', 0, 0, 256, 128, 0, actorKinds),
      {
        ...rectangle('bridge-deck', 0, 0, 192, 128, 128, actorKinds),
        barriers: [{from: {x: 128, y: 0}, to: {x: 128, y: 128}}]
      }
    ],
    transitions: []
  }));

  assert.deepEqual(
    world.physicsGeometry('bridge-deck').barriers,
    [],
    'a side face one block before a lower landing must not act as a guardrail'
  );
});

test('generated world traverses a real GTA2 road ramp onto an overlapping bridge deck', {
  skip: !hasLocalAssets
}, () => {
  const world = CollisionMap.load();
  const y = 7168;
  let x = 6528;
  let surfaceId = 'street-surface-200-0-2';

  assert.equal(world.heightAt(surfaceId, x, y), 128);
  assert.equal(world.canOccupy(x, y, 11, surfaceId, 'player'), true);

  for (const toX of [
    6560,
    6588,
    6604,
    6624,
    6656,
    6688,
    6716,
    6732,
    6752,
    6816,
    6848
  ] as const) {
    const next = world.surfaceAfterMove(
      surfaceId, x, y, toX, y, 11, 'player'
    );
    assert.ok(next, `movement ${x}-${toX} must stay on a physical surface`);
    surfaceId = next;
    x = toX;
  }

  assert.equal(surfaceId, 'street-surface-105-110-3');
  assert.equal(world.heightAt(surfaceId, x, y), 192);
  assert.deepEqual(
    world.surfaces.surfaceIdsAt(6848, 7744, 'vehicle')
      .map((candidate) => [candidate, world.heightAt(candidate, 6848, 7744)]),
    [
      ['street-surface-105-110-3', 192],
      ['street-surface-200-0-2', 128]
    ]
  );
});

test('generated world preserves the lower roadway beneath an elevated bridge deck', {
  skip: !hasLocalAssets
}, () => {
  const world = CollisionMap.load();
  const lowerSurfaceId = 'street-surface-200-0-2';
  const upperSurfaceId = 'street-surface-113-149-3';
  const underpassX = 7600;
  const underpassY = 10008;

  assert.deepEqual(
    world.surfaces.surfaceIdsAt(underpassX, underpassY, 'vehicle')
      .map((surfaceId) => [surfaceId, world.heightAt(surfaceId, underpassX, underpassY)]),
    [
      [upperSurfaceId, 192],
      [lowerSurfaceId, 128]
    ]
  );
  assert.equal(
    world.canOccupy(underpassX, underpassY, 20, upperSurfaceId, 'vehicle'),
    true
  );
  assert.equal(
    world.canOccupy(underpassX, underpassY, 20, lowerSurfaceId, 'vehicle'),
    true
  );

  let x = 7800;
  for (const toX of [7700, 7600, 7500, 7400] as const) {
    assert.equal(
      world.surfaceAfterMove(
        lowerSurfaceId,
        x,
        underpassY,
        toX,
        underpassY,
        20,
        'vehicle'
      ),
      lowerSurfaceId
    );
    x = toX;
  }
});

test('generated world preserves the open passage through a tall bridge structure', {
  skip: !hasLocalAssets
}, () => {
  const world = CollisionMap.load();
  const lowerSurfaceId = 'street-surface-200-0-2';
  const upperSurfaceId = 'street-surface-57-40-6';
  const passageY = 2656;

  assert.deepEqual(
    world.surfaces.surfaceIdsAt(3744, passageY, 'vehicle')
      .map((surfaceId) => [surfaceId, world.heightAt(surfaceId, 3744, passageY)]),
    [
      [lowerSurfaceId, 128],
      [upperSurfaceId, 384]
    ]
  );
  assert.deepEqual(
    world.surfaces.surfaceIdsAt(3744, 2592, 'vehicle')
      .map((surfaceId) => [surfaceId, world.heightAt(surfaceId, 3744, 2592)]),
    [[upperSurfaceId, 384]],
    'solid bridge support rows must not become lower passages'
  );

  let x = 3552;
  for (const toX of [3616, 3744, 3872, 4000, 4064] as const) {
    assert.equal(
      world.surfaceAfterMove(
        lowerSurfaceId,
        x,
        passageY,
        toX,
        passageY,
        20,
        'vehicle'
      ),
      lowerSurfaceId
    );
    x = toX;
  }
});

test('generated tall bridge exposes its inset south drop edge to vehicle physics', {
  skip: !hasLocalAssets
}, () => {
  const world = CollisionMap.load();
  const upperSurfaceId = 'street-surface-57-40-6';
  const geometry = world.physicsGeometry(upperSurfaceId);

  assert.equal(geometry.barriers?.some((barrier) => (
    barrier.from.x === 3712 && barrier.from.y === 2688 &&
    barrier.to.x === 3776 && barrier.to.y === 2688
  )), false, 'the GTA2 side face inset from the south ledge must be open');
  assert.deepEqual(
    world.dropTargetAfterMove(upperSurfaceId, 3744, 2656, 3744, 2780, 20, 'vehicle'),
    {surfaceId: 'street-surface-200-0-2', height: 128}
  );
});

function layeredFixture(): SurfaceManifest {
  const actorKinds = ['player', 'pedestrian', 'vehicle', 'projectile', 'prop'] as const;
  return {
    version: 1,
    collisionRevision: 2,
    blockSize: 64,
    defaultSurfaceId: 'street-ground',
    surfaces: [
      rectangle('street-ground', 0, 0, 64, 64, 0, actorKinds),
      {
        id: 'bridge-ramp',
        spaceId: 'street',
        actorKinds,
        triangles: [
          {
            a: {x: 64, y: 0, z: 0},
            b: {x: 128, y: 0, z: 128},
            c: {x: 128, y: 64, z: 128}
          },
          {
            a: {x: 64, y: 0, z: 0},
            b: {x: 128, y: 64, z: 128},
            c: {x: 64, y: 64, z: 0}
          }
        ]
      },
      rectangle('bridge-deck', 64, 0, 128, 64, 128, actorKinds)
    ],
    transitions: [{
      id: 'ground-ramp',
      fromSurfaceId: 'street-ground',
      toSurfaceId: 'bridge-ramp',
      from: {x: 64, y: 0},
      to: {x: 64, y: 64},
      actorKinds,
      bidirectional: true
    }, {
      id: 'ramp-deck',
      fromSurfaceId: 'bridge-ramp',
      toSurfaceId: 'bridge-deck',
      from: {x: 128, y: 0},
      to: {x: 128, y: 64},
      actorKinds,
      bidirectional: true
    }]
  };
}

function rectangle(
  id: string,
  minimumX: number,
  minimumY: number,
  maximumX: number,
  maximumY: number,
  z: number,
  actorKinds: SurfaceManifest['surfaces'][number]['actorKinds']
): SurfaceManifest['surfaces'][number] {
  return {
    id,
    spaceId: 'street',
    actorKinds,
    triangles: [
      {
        a: {x: minimumX, y: minimumY, z},
        b: {x: maximumX, y: minimumY, z},
        c: {x: maximumX, y: maximumY, z}
      },
      {
        a: {x: minimumX, y: minimumY, z},
        b: {x: maximumX, y: maximumY, z},
        c: {x: minimumX, y: maximumY, z}
      }
    ]
  };
}

function physicsCellAt(
  geometry: ReturnType<CollisionMap['physicsGeometry']>,
  x: number,
  y: number
): number {
  const column = Math.floor((x - (geometry.originX ?? 0)) / geometry.tileWidth);
  const row = Math.floor((y - (geometry.originY ?? 0)) / geometry.tileHeight);
  return geometry.collisions[row * geometry.width + column];
}
