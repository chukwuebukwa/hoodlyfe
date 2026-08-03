import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {parseBuildingManifest, BUILDING_MANIFEST} from '../../shared/content/building-manifest.ts';
import {
  compileSeamlessInteriorCatalog,
  type SeamlessInteriorCatalog
} from '../../shared/content/seamless-interior-catalog.ts';
import {
  parseWorldContentManifest,
  parseWorldContentPointer,
  worldContentAssetKey,
  worldContentCurrentKey,
  worldContentManifestKey,
  type WorldContentDescriptor,
  type WorldContentManifest
} from '../../shared/content/world-content.ts';
import {SurfaceMap, type SurfaceManifest} from '../../shared/world/surface-map.ts';
import {LaneGraph, type LaneGraphDocument} from '../game/traffic/lane-graph.ts';
import {
  bucketStorageEnabled,
  readBucketObject,
  readBucketJson
} from '../storage/bucket-object-store.ts';
import {CollisionMap, type MapMetadata, type TiledMapData} from '../world-map.ts';

export interface WorldContentSnapshot {
  readonly descriptor: WorldContentDescriptor;
  readonly buildings: SeamlessInteriorCatalog;
  createWorld(): CollisionMap;
  createLaneGraph(world: CollisionMap): LaneGraph;
}

export interface WorldContentRepository {
  resolveCurrent(worldId: string): Promise<WorldContentSnapshot>;
}

interface WorldSourceDocuments {
  map: TiledMapData;
  metadata: MapMetadata;
  surfaces: SurfaceManifest;
  lanes: LaneGraphDocument;
}

const STANDARD_FILES = Object.freeze({
  districtMap: 'maps/district-map.json',
  metadata: 'maps/district-map.metadata.json',
  surfaces: 'maps/surface-manifest.json',
  lanes: 'maps/district-lanes.json',
  geometry: 'maps/geometry/world.json',
  buildings: 'content/buildings.json'
});

export class BundledWorldContentRepository implements WorldContentRepository {
  private snapshot?: Promise<WorldContentSnapshot>;

  constructor(private readonly projectRoot = process.cwd()) {}

  resolveCurrent(worldId: string): Promise<WorldContentSnapshot> {
    if (worldId !== 'bil') throw new Error(`Bundled world content is unavailable for "${worldId}".`);
    this.snapshot ??= this.load();
    return this.snapshot;
  }

  private async load(): Promise<WorldContentSnapshot> {
    const maps = resolve(this.projectRoot, 'public', 'assets', 'maps');
    const paths = {
      map: resolve(maps, 'district-map.json'),
      metadata: resolve(maps, 'district-map.metadata.json'),
      surfaces: resolve(maps, 'surface-manifest.json'),
      lanes: resolve(maps, 'district-lanes.json'),
      geometry: resolve(maps, 'geometry', 'world.json')
    };
    const [mapText, metadataText, surfacesText, lanesText, geometryText] = await Promise.all([
      readFile(paths.map, 'utf8'),
      readFile(paths.metadata, 'utf8'),
      readFile(paths.surfaces, 'utf8'),
      readFile(paths.lanes, 'utf8'),
      readFile(paths.geometry, 'utf8')
    ]);
    const revision = `bundled-${createHash('sha256')
      .update(mapText)
      .update(metadataText)
      .update(surfacesText)
      .update(lanesText)
      .update(geometryText)
      .update(JSON.stringify(BUILDING_MANIFEST))
      .digest('hex').slice(0, 20)}`;
    return createSnapshot({
      descriptor: {
        schemaVersion: 1,
        worldId: 'bil',
        revision,
        source: 'bundled',
        assetRoot: '/assets',
        buildingsPath: ''
      },
      documents: {
        map: JSON.parse(mapText) as TiledMapData,
        metadata: JSON.parse(metadataText) as MapMetadata,
        surfaces: JSON.parse(surfacesText) as SurfaceManifest,
        lanes: JSON.parse(lanesText) as LaneGraphDocument
      },
      buildings: compileSeamlessInteriorCatalog(BUILDING_MANIFEST)
    });
  }
}

export class BucketWorldContentRepository implements WorldContentRepository {
  private readonly readObject?: (key: string) => Promise<Uint8Array | undefined>;
  private readonly snapshots = new Map<string, Promise<WorldContentSnapshot>>();

  constructor(
    private readonly readJson: <T>(key: string) => Promise<T | undefined> = readBucketJson,
    private readonly storageEnabled: () => boolean = bucketStorageEnabled,
    readObject?: (key: string) => Promise<Uint8Array | undefined>
  ) {
    this.readObject = readObject ?? (readJson === readBucketJson ? readBucketObject : undefined);
  }

  async resolveCurrent(worldId: string): Promise<WorldContentSnapshot> {
    if (!this.storageEnabled()) throw new Error('WORLD_CONTENT_SOURCE=bucket requires bucket credentials.');
    const pointerRaw = await this.readJson<unknown>(worldContentCurrentKey(worldId));
    if (!pointerRaw) throw new Error(`Bucket world "${worldId}" has no current revision.`);
    const pointer = parseWorldContentPointer(pointerRaw, worldContentCurrentKey(worldId));
    if (pointer.worldId !== worldId) throw new Error('World content pointer id does not match its key.');
    const cacheKey = `${worldId}:${pointer.revision}`;
    const cached = this.snapshots.get(cacheKey);
    if (cached) return cached;
    const snapshot = this.loadRevision(worldId, pointer.revision).catch((error) => {
      if (this.snapshots.get(cacheKey) === snapshot) this.snapshots.delete(cacheKey);
      throw error;
    });
    this.snapshots.set(cacheKey, snapshot);
    return snapshot;
  }

  private async loadRevision(worldId: string, revision: string): Promise<WorldContentSnapshot> {
    const manifestKey = worldContentManifestKey(worldId, revision);
    const manifestRaw = await this.readJson<unknown>(manifestKey);
    if (!manifestRaw) throw new Error(`World content revision is missing ${manifestKey}.`);
    const manifest = parseWorldContentManifest(manifestRaw, manifestKey);
    if (manifest.worldId !== worldId || manifest.revision !== revision) {
      throw new Error('World content manifest does not match the requested revision.');
    }
    assertStandardPackageLayout(manifest);
    const [map, metadata, surfaces, lanes, buildingSource] = await Promise.all([
      readRequired<TiledMapData>(this.readJson, this.readObject, worldId, manifest, manifest.files.districtMap),
      readRequired<MapMetadata>(this.readJson, this.readObject, worldId, manifest, manifest.files.metadata),
      readRequired<SurfaceManifest>(this.readJson, this.readObject, worldId, manifest, manifest.files.surfaces),
      readRequired<LaneGraphDocument>(this.readJson, this.readObject, worldId, manifest, manifest.files.lanes),
      readRequired<unknown>(this.readJson, this.readObject, worldId, manifest, manifest.files.buildings)
    ]);
    const buildings = compileSeamlessInteriorCatalog(
      parseBuildingManifest(buildingSource, manifest.files.buildings)
    );
    return createSnapshot({
      descriptor: {
        schemaVersion: 1,
        worldId,
        revision: manifest.revision,
        source: 'bucket',
        assetRoot: `/api/world-content/assets/${encodeURIComponent(worldId)}/${encodeURIComponent(manifest.revision)}`,
        buildingsPath: manifest.files.buildings
      },
      documents: {map, metadata, surfaces, lanes},
      buildings
    });
  }
}

export class WorldContentManager implements WorldContentRepository {
  private readonly cache = new Map<string, {expiresAt: number; value: Promise<WorldContentSnapshot>}>();

  constructor(
    private readonly repository: WorldContentRepository,
    private readonly cacheMs = 15_000,
    private readonly now = Date.now
  ) {}

  resolveCurrent(worldId: string): Promise<WorldContentSnapshot> {
    const cached = this.cache.get(worldId);
    if (cached && cached.expiresAt > this.now()) return cached.value;
    const value = this.repository.resolveCurrent(worldId).catch((error) => {
      if (this.cache.get(worldId)?.value === value) this.cache.delete(worldId);
      throw error;
    });
    this.cache.set(worldId, {expiresAt: this.now() + this.cacheMs, value});
    return value;
  }
}

export function worldContentRepositoryFromEnvironment(
  environment: Record<string, string | undefined> = process.env,
  projectRoot = process.cwd()
): WorldContentRepository {
  const source = environment.WORLD_CONTENT_SOURCE ?? 'bundled';
  if (source === 'bundled') return new WorldContentManager(new BundledWorldContentRepository(projectRoot));
  if (source === 'bucket') return new WorldContentManager(new BucketWorldContentRepository());
  throw new Error(`Unsupported WORLD_CONTENT_SOURCE "${source}".`);
}

function createSnapshot(input: {
  descriptor: WorldContentDescriptor;
  documents: WorldSourceDocuments;
  buildings: SeamlessInteriorCatalog;
}): WorldContentSnapshot {
  const {descriptor, documents, buildings} = input;
  return Object.freeze({
    descriptor: Object.freeze(descriptor),
    buildings,
    createWorld: () => new CollisionMap(
      documents.map,
      documents.metadata,
      new SurfaceMap(documents.surfaces),
      buildings
    ),
    createLaneGraph: (world: CollisionMap) => LaneGraph.fromDocument(documents.lanes, world)
  });
}

async function readRequired<T>(
  readJson: <Value>(key: string) => Promise<Value | undefined>,
  readObject: ((key: string) => Promise<Uint8Array | undefined>) | undefined,
  worldId: string,
  manifest: WorldContentManifest,
  path: string
): Promise<T> {
  const key = worldContentAssetKey(worldId, manifest.revision, path);
  if (readObject) {
    const body = await readObject(key);
    if (!body) throw new Error(`World content asset is missing ${key}.`);
    const expected = manifest.checksums?.[path];
    if (expected) {
      const actual = createHash('sha256').update(body).digest('hex');
      if (actual !== expected) throw new Error(`World content checksum mismatch for ${key}.`);
    }
    return JSON.parse(new TextDecoder().decode(body)) as T;
  }
  const value = await readJson<T>(key);
  if (value === undefined) throw new Error(`World content asset is missing ${key}.`);
  return value;
}

function assertStandardPackageLayout(manifest: WorldContentManifest): void {
  for (const [name, expected] of Object.entries(STANDARD_FILES)) {
    const actual = manifest.files[name as keyof typeof STANDARD_FILES];
    if (actual !== expected) {
      throw new Error(`World content ${name} must be stored at "${expected}".`);
    }
  }
}
