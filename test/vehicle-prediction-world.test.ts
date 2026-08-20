import assert from 'node:assert/strict';
import test from 'node:test';
import {vehicleMechanicalStepModifiers} from '../shared/simulation/vehicle-step.ts';
import {SurfaceMap, type SurfaceManifest} from '../shared/world/surface-map.ts';
import {SurfaceVehiclePredictionWorld} from '../src/game/network/vehicle-prediction-world.ts';

const healthy = vehicleMechanicalStepModifiers(0, false, 0);

test('vehicle prediction advances over valid authored road surface', () => {
  const world = new SurfaceVehiclePredictionWorld(new SurfaceMap(fixture()));
  const start = pose({x: -300, y: 250, speed: 120, linvelX: 120});
  const moved = world.step(start, {x: 0, y: -1, handbrake: false}, healthy);

  assert.ok(moved.x > start.x);
  assert.equal(moved.surfaceId, 'street-ground');
});

test('vehicle prediction rejects movement whose footprint leaves the authored surface', () => {
  const world = new SurfaceVehiclePredictionWorld(new SurfaceMap(fixture()));
  const start = pose({x: -486, y: 250, angle: Math.PI, speed: 120, linvelX: -120});
  const moved = world.step(start, {x: 0, y: -1, handbrake: false}, healthy);

  assert.equal(moved.x, start.x);
  assert.equal(moved.y, start.y);
  assert.equal(moved.speed, 0);
});

test('vehicle prediction follows an explicit connected surface transition', () => {
  const world = new SurfaceVehiclePredictionWorld(new SurfaceMap(fixture()));
  const start = pose({x: -1, y: 250, speed: 120, linvelX: 120});
  const moved = world.step(start, {x: 0, y: -1, handbrake: false}, healthy);

  assert.ok(moved.x > 0);
  assert.equal(moved.surfaceId, 'bridge-ramp');
});

function pose(overrides: Partial<ReturnType<typeof basePose>> = {}) {
  return {...basePose(), ...overrides};
}

function basePose() {
  return {
    playerId: 'player-1',
    vehicleId: 'vehicle-1',
    kind: 'sedan',
    surfaceId: 'street-ground',
    x: -300,
    y: 250,
    angle: 0,
    speed: 0,
    linvelX: 0,
    linvelY: 0,
    angvel: 0
  };
}

function fixture(): SurfaceManifest {
  const actorKinds = ['player', 'pedestrian', 'vehicle', 'projectile', 'prop'] as const;
  return {
    version: 1,
    collisionRevision: 2,
    blockSize: 64,
    defaultSurfaceId: 'street-ground',
    surfaces: [
      flatSurface('street-ground', -500, 0, 0, actorKinds),
      {
        id: 'bridge-ramp',
        spaceId: 'street',
        actorKinds,
        triangles: [
          triangle(point(0, 0, 0), point(500, 0, 128), point(500, 500, 128)),
          triangle(point(0, 0, 0), point(500, 500, 128), point(0, 500, 0))
        ]
      }
    ],
    transitions: [{
      id: 'ground-to-ramp',
      fromSurfaceId: 'street-ground',
      toSurfaceId: 'bridge-ramp',
      from: {x: 0, y: 0},
      to: {x: 0, y: 500},
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
      triangle(point(minX, 0, height), point(maxX, 0, height), point(maxX, 500, height)),
      triangle(point(minX, 0, height), point(maxX, 500, height), point(minX, 500, height))
    ]
  };
}

function point(x: number, y: number, z: number) {
  return {x, y, z};
}

function triangle(a: ReturnType<typeof point>, b: ReturnType<typeof point>, c: ReturnType<typeof point>) {
  return {a, b, c};
}
