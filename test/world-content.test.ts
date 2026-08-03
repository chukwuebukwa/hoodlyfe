import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import test from 'node:test';
import rawBuildings from '../shared/content/buildings/buildings.json';
import {
  parseWorldContentManifest,
  parseWorldContentPointer,
  worldContentAssetKey,
  worldContentCurrentKey,
  worldContentManifestKey
} from '../shared/content/world-content.ts';
import {
  BucketWorldContentRepository,
  BundledWorldContentRepository,
  WorldContentManager,
  type WorldContentRepository,
  type WorldContentSnapshot
} from '../server/world-content/world-content-repository.ts';

const publishedAt = '2026-08-03T12:00:00.000Z';
const revision = '0123456789abcdef01234567';

test('world content contracts produce immutable revision keys and reject traversal', () => {
  assert.equal(worldContentCurrentKey('bil'), 'worlds/bil/current.json');
  assert.equal(
    worldContentManifestKey('bil', revision),
    `worlds/bil/revisions/${revision}/manifest.json`
  );
  assert.equal(
    worldContentAssetKey('bil', revision, 'maps/geometry/world.json'),
    `worlds/bil/revisions/${revision}/maps/geometry/world.json`
  );
  assert.throws(() => worldContentAssetKey('bil', revision, '../secret'), /safe relative path/);
  assert.throws(() => parseWorldContentPointer({
    schemaVersion: 1,
    worldId: 'bil',
    revision: 'short',
    publishedAt
  }), /revision is invalid/);
});

test('world content manifests accept bounded delta revision inheritance', () => {
  const files = standardFiles();
  const parsed = parseWorldContentManifest({
    schemaVersion: 1,
    engineSchemaVersion: 1,
    worldId: 'bil',
    revision: 'fedcba9876543210fedcba98',
    baseRevision: revision,
    publishedAt,
    objects: ['maps/geometry/world.json', 'content/buildings.json'],
    files,
    checksums: Object.fromEntries(Object.values(files).map((path) => [path, 'a'.repeat(64)]))
  });
  assert.equal(parsed.baseRevision, revision);
  assert.deepEqual(parsed.objects, ['maps/geometry/world.json', 'content/buildings.json']);
  assert.throws(() => parseWorldContentManifest({
    ...parsed,
    baseRevision: parsed.revision
  }), /cannot reference itself/);
});

test('bundled repository creates independent worlds pinned to one content revision', async () => {
  const snapshot = await new BundledWorldContentRepository().resolveCurrent('bil');
  const first = snapshot.createWorld();
  const second = snapshot.createWorld();
  assert.match(snapshot.descriptor.revision, /^bundled-[a-f0-9]{20}$/);
  assert.equal(snapshot.descriptor.assetRoot, '/assets');
  assert.equal(snapshot.descriptor.buildingsPath, '');
  assert.notEqual(first, second);
  assert.equal(first.seamlessInteriors, snapshot.buildings);
  assert.ok(snapshot.buildings.interiors.some(({id}) => id === 'quick-stop-market'));
  assert.doesNotThrow(() => snapshot.createLaneGraph(first));
});

test('bucket repository loads authoritative server inputs and returns an exact client root', async () => {
  const maps = resolve(process.cwd(), 'public', 'assets', 'maps');
  const manifest = parseWorldContentManifest({
    schemaVersion: 1,
    engineSchemaVersion: 1,
    worldId: 'bil',
    revision,
    publishedAt,
    files: standardFiles()
  });
  const values = new Map<string, unknown>([
    [worldContentCurrentKey('bil'), {schemaVersion: 1, worldId: 'bil', revision, publishedAt}],
    [worldContentManifestKey('bil', revision), manifest],
    [worldContentAssetKey('bil', revision, manifest.files.districtMap), json(resolve(maps, 'district-map.json'))],
    [worldContentAssetKey('bil', revision, manifest.files.metadata), json(resolve(maps, 'district-map.metadata.json'))],
    [worldContentAssetKey('bil', revision, manifest.files.surfaces), json(resolve(maps, 'surface-manifest.json'))],
    [worldContentAssetKey('bil', revision, manifest.files.lanes), json(resolve(maps, 'district-lanes.json'))],
    [worldContentAssetKey('bil', revision, manifest.files.buildings), rawBuildings]
  ]);
  let reads = 0;
  const repository = new BucketWorldContentRepository(
    async <T>(key: string) => {
      reads += 1;
      return values.get(key) as T | undefined;
    },
    () => true
  );
  const snapshot = await repository.resolveCurrent('bil');
  assert.equal(snapshot.descriptor.revision, revision);
  assert.equal(snapshot.descriptor.source, 'bucket');
  assert.equal(
    snapshot.descriptor.assetRoot,
    `/api/world-content/assets/bil/${revision}`
  );
  const world = snapshot.createWorld();
  assert.equal(world.seamlessInteriors, snapshot.buildings);
  assert.doesNotThrow(() => snapshot.createLaneGraph(world));
  const readsAfterLoad = reads;
  assert.equal(await repository.resolveCurrent('bil'), snapshot);
  assert.equal(reads, readsAfterLoad + 1);
});

test('bucket repository resolves unchanged authority files through a delta base revision', async () => {
  const maps = resolve(process.cwd(), 'public', 'assets', 'maps');
  const deltaRevision = 'fedcba9876543210fedcba98';
  const files = standardFiles();
  const baseManifest = parseWorldContentManifest({
    schemaVersion: 1,
    engineSchemaVersion: 1,
    worldId: 'bil',
    revision,
    publishedAt,
    files
  });
  const deltaManifest = parseWorldContentManifest({
    ...baseManifest,
    revision: deltaRevision,
    baseRevision: revision,
    objects: [files.buildings]
  });
  const values = new Map<string, unknown>([
    [worldContentCurrentKey('bil'), {schemaVersion: 1, worldId: 'bil', revision: deltaRevision, publishedAt}],
    [worldContentManifestKey('bil', revision), baseManifest],
    [worldContentManifestKey('bil', deltaRevision), deltaManifest],
    [worldContentAssetKey('bil', revision, files.districtMap), json(resolve(maps, 'district-map.json'))],
    [worldContentAssetKey('bil', revision, files.metadata), json(resolve(maps, 'district-map.metadata.json'))],
    [worldContentAssetKey('bil', revision, files.surfaces), json(resolve(maps, 'surface-manifest.json'))],
    [worldContentAssetKey('bil', revision, files.lanes), json(resolve(maps, 'district-lanes.json'))],
    [worldContentAssetKey('bil', deltaRevision, files.buildings), rawBuildings]
  ]);
  const repository = new BucketWorldContentRepository(
    async <T>(key: string) => values.get(key) as T | undefined,
    () => true
  );
  const snapshot = await repository.resolveCurrent('bil');
  assert.equal(snapshot.descriptor.revision, deltaRevision);
  assert.ok(snapshot.buildings.interiors.some(({id}) => id === 'quick-stop-market'));
});

test('bucket repository rejects corrupted authoritative world assets', async () => {
  const manifest = {
    schemaVersion: 1,
    engineSchemaVersion: 1,
    worldId: 'bil',
    revision,
    publishedAt,
    files: standardFiles(),
    checksums: Object.fromEntries(
      Object.values(standardFiles()).map((path) => [path, '0'.repeat(64)])
    )
  };
  const repository = new BucketWorldContentRepository(
    async <T>(key: string) => {
      if (key === worldContentCurrentKey('bil')) {
        return {schemaVersion: 1, worldId: 'bil', revision, publishedAt} as T;
      }
      if (key === worldContentManifestKey('bil', revision)) return manifest as T;
      return undefined;
    },
    () => true,
    async () => new TextEncoder().encode('{}')
  );
  await assert.rejects(repository.resolveCurrent('bil'), /checksum mismatch/);
});

test('world content manager reuses a snapshot only inside its bounded current-pointer window', async () => {
  const bundled = await new BundledWorldContentRepository().resolveCurrent('bil');
  let now = 100;
  let resolves = 0;
  const source: WorldContentRepository = {
    resolveCurrent: async (): Promise<WorldContentSnapshot> => {
      resolves += 1;
      return bundled;
    }
  };
  const manager = new WorldContentManager(source, 50, () => now);
  assert.equal(await manager.resolveCurrent('bil'), await manager.resolveCurrent('bil'));
  assert.equal(resolves, 1);
  now = 151;
  await manager.resolveCurrent('bil');
  assert.equal(resolves, 2);
});

function standardFiles() {
  return {
    districtMap: 'maps/district-map.json',
    metadata: 'maps/district-map.metadata.json',
    surfaces: 'maps/surface-manifest.json',
    lanes: 'maps/district-lanes.json',
    geometry: 'maps/geometry/world.json',
    buildings: 'content/buildings.json'
  };
}

function json(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}
