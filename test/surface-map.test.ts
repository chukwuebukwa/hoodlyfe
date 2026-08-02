import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {SurfaceMap, type SurfaceManifest} from '../shared/world/surface-map.ts';

test('surface map keeps overlapping ground and bridge sheets physically distinct', () => {
  const surfaces = new SurfaceMap(fixture());

  assert.equal(surfaces.heightAt('street-ground', 150, 50), 0);
  assert.equal(surfaces.heightAt('bridge-deck', 150, 50), 128);
  assert.equal(surfaces.canOccupy('street-ground', 150, 50, 10, 'player'), true);
  assert.equal(surfaces.canOccupy('bridge-deck', 150, 50, 10, 'vehicle'), true);
  assert.equal(surfaces.canOccupy('bridge-ramp', 95, 50, 10, 'pedestrian'), false);
});

test('surface map samples slopes and exposes explicit actor-gated transitions', () => {
  const surfaces = new SurfaceMap(fixture());

  assert.equal(surfaces.heightAt('bridge-ramp', 50, 50), 64);
  assert.deepEqual(surfaces.neighbors('street-ground', 'player'), ['bridge-ramp']);
  assert.deepEqual(surfaces.transitionFor('street-ground', -10, 50, 10, 50, 'player'), {
    transitionId: 'ground-to-ramp',
    surfaceId: 'bridge-ramp'
  });
  assert.deepEqual(surfaces.transitionFor('bridge-ramp', 90, 50, 110, 50, 'vehicle'), {
    transitionId: 'ramp-to-bridge',
    surfaceId: 'bridge-deck'
  });
  assert.equal(
    surfaces.transitionFor('bridge-ramp', 0, 50, 10, 50, 'player'),
    undefined,
    'starting on a seam must not bounce an actor back to its previous surface'
  );
  assert.deepEqual(surfaces.transitionFor('bridge-deck', 100, 50, 90, 50, 'vehicle'), {
    transitionId: 'ramp-to-bridge',
    surfaceId: 'bridge-ramp'
  });
  assert.equal(
    surfaces.transitionFor('street-ground', 0, 200, 0, 300, 'player'),
    undefined
  );
  assert.equal(surfaces.transitionFor('street-ground', -10, 50, 10, 50, 'projectile'), undefined);
});

test('bucket lookup and fused footprint checks preserve transitioned surface identity', () => {
  const surfaces = new SurfaceMap(fixture());
  assert.deepEqual(
    surfaces.surfaceIdsAt(64, 50, 'vehicle'),
    ['bridge-ramp', 'street-ground']
  );
  const sampledSurfaceIds = new Set<string>();
  assert.equal(surfaces.canOccupyConnected(
    'street-ground',
    -5,
    50,
    10,
    'player',
    (surfaceId) => {
      sampledSurfaceIds.add(surfaceId);
      return true;
    }
  ), true);
  assert.deepEqual([...sampledSurfaceIds].sort(), ['bridge-ramp', 'street-ground']);
});

test('surface map resolves the highest compatible landing below an airborne actor', () => {
  const surfaces = new SurfaceMap(fixture());

  assert.deepEqual(
    surfaces.highestSurfaceBelow('', 150, 50, 10, 'vehicle', 140),
    {surfaceId: 'bridge-deck', height: 128}
  );
  assert.deepEqual(
    surfaces.highestSurfaceBelow('bridge-deck', 150, 50, 10, 'vehicle', 140),
    {surfaceId: 'street-ground', height: 0}
  );
  assert.equal(
    surfaces.highestSurfaceBelow('', 150, 50, 10, 'projectile', 0),
    undefined
  );
});

test('surface map rejects invalid topology at the asset seam', () => {
  const manifest = fixture();
  assert.throws(() => new SurfaceMap({...manifest, version: 2}), /Unsupported surface manifest/);
  assert.throws(() => new SurfaceMap({...manifest, collisionRevision: 1}), /collision revision/);
  assert.throws(() => new SurfaceMap({
    ...manifest,
    transitions: [{...manifest.transitions[0], toSurfaceId: 'missing'}]
  }), /two existing distinct surfaces/);
  assert.throws(() => new SurfaceMap({
    ...manifest,
    surfaces: [...manifest.surfaces, manifest.surfaces[0]]
  }), /Duplicate surface ID/);
  assert.throws(() => new SurfaceMap({
    ...manifest,
    transitions: [{...manifest.transitions[0], from: {x: 50, y: 0}, to: {x: 50, y: 100}}]
  }), /not height-continuous/);
  assert.throws(() => new SurfaceMap({
    ...manifest,
    surfaces: manifest.surfaces.map((surface) => surface.id === 'bridge-deck'
      ? {...surface, barriers: [{from: {x: 100, y: 50}, to: {x: 100, y: 50}}]}
      : surface)
  }), /barrier 0 must have length/);
});

test('surface map preserves authored GTA2 side barriers', () => {
  const manifest = fixture();
  const surfaces = new SurfaceMap({
    ...manifest,
    surfaces: manifest.surfaces.map((surface) => surface.id === 'bridge-deck'
      ? {...surface, barriers: [{from: {x: 100, y: 0}, to: {x: 100, y: 100}}]}
      : surface)
  });

  assert.deepEqual(surfaces.surface('bridge-deck')?.barriers, [{
    from: {x: 100, y: 0},
    to: {x: 100, y: 100}
  }]);
  assert.deepEqual(surfaces.surface('street-ground')?.barriers, []);
});

test('generated district manifest preserves stacked authoritative surfaces', () => {
  const surfaces = new SurfaceMap(JSON.parse(
    readFileSync('public/assets/maps/surface-manifest.json', 'utf8')
  ));
  const heights = surfaces.manifest.surfaces
    .map((surface) => surfaces.heightAt(surface.id, 5_984, 160))
    .filter((height): height is number => height !== undefined)
    .sort((left, right) => left - right);

  assert.equal(surfaces.manifest.collisionRevision, 2);
  assert.ok(surfaces.manifest.surfaces.length > 4_000);
  assert.ok(surfaces.manifest.transitions.length > 4_000);
  assert.deepEqual(heights, [64, 128]);
});

test('generated district manifest exposes a continuous ground-ramp-deck route', () => {
  const surfaces = new SurfaceMap(JSON.parse(
    readFileSync('public/assets/maps/surface-manifest.json', 'utf8')
  ));
  const x = 224;
  const ground = surfaces.surfaceIdsAt(x, 2488, 'player')
    .find((surfaceId) => surfaces.heightAt(surfaceId, x, 2488) === 64);
  const ramp = 'street-surface-0-39-2';
  const deck = 'street-surface-3-40-2';

  assert.ok(ground);
  assert.deepEqual(surfaces.transitionFor(ground, x, 2488, x, 2504, 'player'), {
    transitionId: 'surface-transition-693',
    surfaceId: ramp
  });
  assert.equal(surfaces.heightAt(ramp, x, 2528), 96);
  assert.deepEqual(surfaces.transitionFor(ramp, x, 2550, x, 2568, 'vehicle'), {
    transitionId: 'surface-transition-713',
    surfaceId: deck
  });
  assert.equal(surfaces.heightAt(deck, x, 2600), 128);
});

function fixture(): SurfaceManifest {
  const all = ['player', 'pedestrian', 'vehicle', 'projectile', 'prop'] as const;
  return {
    version: 1,
    collisionRevision: 2,
    blockSize: 64,
    defaultSurfaceId: 'street-ground',
    surfaces: [
      surface('street-ground', -100, 200, 0, all),
      surface('bridge-deck', 100, 300, 128, all),
      {
        id: 'bridge-ramp',
        spaceId: 'street',
        actorKinds: ['player', 'pedestrian', 'vehicle'],
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
    }, {
      id: 'ramp-to-bridge',
      fromSurfaceId: 'bridge-ramp',
      toSurfaceId: 'bridge-deck',
      from: {x: 100, y: 0},
      to: {x: 100, y: 100},
      actorKinds: ['player', 'pedestrian', 'vehicle'],
      bidirectional: true
    }]
  };
}

function surface(
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
