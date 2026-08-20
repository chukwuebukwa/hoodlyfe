import assert from 'node:assert/strict';
import test from 'node:test';
import {SurfaceMap, type SurfaceManifest} from '../shared/world/surface-map.ts';
import {SurfaceOnFootPredictionWorld} from '../src/game/network/on-foot-prediction-world.ts';

test('prediction rejects movement when the player footprint leaves an authored surface', () => {
  const world = new SurfaceOnFootPredictionWorld(new SurfaceMap(fixture()));
  const start = {x: -89, y: 50, spaceId: 'street', surfaceId: 'street-ground'};

  assert.deepEqual(world.step(start, {x: -1, y: 0}, 1), start);
});

test('prediction follows an explicit ground-to-ramp transition', () => {
  const world = new SurfaceOnFootPredictionWorld(new SurfaceMap(fixture()));
  const moved = world.step(
    {x: -1, y: 50, spaceId: 'street', surfaceId: 'street-ground'},
    {x: 1, y: 0},
    1
  );

  assert.ok(moved.x > 0);
  assert.equal(moved.surfaceId, 'bridge-ramp');
});

function fixture(): SurfaceManifest {
  const actorKinds = ['player', 'pedestrian', 'vehicle', 'projectile', 'prop'] as const;
  return {
    version: 1,
    collisionRevision: 2,
    blockSize: 64,
    defaultSurfaceId: 'street-ground',
    surfaces: [
      flatSurface('street-ground', -100, 0, 0, actorKinds),
      {
        id: 'bridge-ramp',
        spaceId: 'street',
        actorKinds,
        triangles: [
          triangle(point(0, 0, 0), point(100, 0, 128), point(100, 100, 128)),
          triangle(point(0, 0, 0), point(100, 100, 128), point(0, 100, 0))
        ]
      }
    ],
    transitions: [{
      id: 'ground-to-ramp',
      fromSurfaceId: 'street-ground',
      toSurfaceId: 'bridge-ramp',
      from: {x: 0, y: 0},
      to: {x: 0, y: 100},
      actorKinds: ['player', 'pedestrian', 'vehicle'],
      bidirectional: true
    }]
  };
}

function flatSurface(
  id: string,
  minX: number,
  maxX: number,
  height: number,
  actorKinds: SurfaceManifest['surfaces'][number]['actorKinds']
) {
  return {
    id,
    spaceId: 'street',
    actorKinds,
    triangles: [
      triangle(point(minX, 0, height), point(maxX, 0, height), point(maxX, 100, height)),
      triangle(point(minX, 0, height), point(maxX, 100, height), point(minX, 100, height))
    ]
  };
}

function point(x: number, y: number, z: number) {
  return {x, y, z};
}

function triangle(a: ReturnType<typeof point>, b: ReturnType<typeof point>, c: ReturnType<typeof point>) {
  return {a, b, c};
}
