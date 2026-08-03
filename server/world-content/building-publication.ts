import {createHash} from 'node:crypto';
import {readFile, rename, writeFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {parseBuildingManifest, type BuildingManifest} from '../../shared/content/building-manifest.ts';
import {
  parseWorldContentManifest,
  parseWorldContentPointer,
  worldContentAssetKey,
  worldContentCurrentKey,
  worldContentManifestKey,
  type WorldContentManifest,
  type WorldContentPointer
} from '../../shared/content/world-content.ts';
import {
  parseBuilderDraft,
  promoteBuildingDraft
} from '../../shared/content/building-draft.ts';
import type {BuildingAuthorDraft} from '../../src/game/building-author/building-candidate-policy.ts';
import {
  bucketObjectExists,
  bucketStorageEnabled,
  putBucketJson,
  putBucketObject,
  readBucketJson,
  readBucketObject
} from '../storage/bucket-object-store.ts';
import {
  addBuildingOccluder,
  geometryChunkOverlapsBuilding,
  partitionBuildingChunk,
  type MutableGeometryChunk,
  type MutableGeometryWorld
} from './building-geometry-partitioner.ts';

export interface BuildingPublicationResult {
  readonly worldId: string;
  readonly revision: string;
  readonly buildingId: string;
  readonly triangleCount: number;
  readonly changedChunks: number;
  readonly source: 'bundled' | 'bucket';
  readonly requiresFreshRoom: boolean;
}

interface PreparedBuildingPublication {
  buildingId: string;
  triangleCount: number;
  manifest: BuildingManifest;
  world: MutableGeometryWorld;
  chunks: Map<string, MutableGeometryChunk>;
}

let publicationTail = Promise.resolve();

export class BuildingPublicationError extends Error {
  constructor(readonly status: 400 | 409 | 503, message: string) {
    super(message);
  }
}

export function publishBuildingDraft(
  worldId: string,
  rawDraft: unknown,
  actor: string,
  environment: Record<string, string | undefined> = process.env,
  projectRoot = process.cwd()
): Promise<BuildingPublicationResult> {
  const operation = publicationTail.then(async () => {
    if (worldId !== 'bil') throw new BuildingPublicationError(400, 'Builder Gun publishing currently supports BIL only.');
    if (environment.NODE_ENV === 'production') {
      if (environment.WORLD_CONTENT_SOURCE !== 'bucket') {
        throw new BuildingPublicationError(409, 'Production must use WORLD_CONTENT_SOURCE=bucket before publishing interiors.');
      }
      if (!bucketStorageEnabled()) throw new BuildingPublicationError(503, 'World bucket storage is not configured.');
      return publishBucketBuilding(worldId, rawDraft, actor);
    }
    return publishLocalBuilding(worldId, rawDraft, projectRoot);
  });
  publicationTail = operation.then(() => undefined, () => undefined);
  return operation;
}

async function publishLocalBuilding(
  worldId: string,
  rawDraft: unknown,
  projectRoot: string
): Promise<BuildingPublicationResult> {
  const mapsRoot = resolve(projectRoot, 'public', 'assets', 'maps');
  const worldPath = resolve(mapsRoot, 'geometry', 'world.json');
  const buildingsPath = resolve(projectRoot, 'shared', 'content', 'buildings', 'buildings.json');
  const [rawManifest, world] = await Promise.all([
    readJsonFile<unknown>(buildingsPath),
    readJsonFile<MutableGeometryWorld>(worldPath)
  ]);
  const prepared = await preparePublication(rawDraft, rawManifest, world, async (file) => (
    readJsonFile<MutableGeometryChunk>(resolve(dirname(worldPath), file))
  ));
  const writes = [
    atomicJsonWrite(buildingsPath, prepared.manifest),
    atomicJsonWrite(worldPath, prepared.world),
    ...[...prepared.chunks].map(([file, chunk]) => (
      atomicJsonWrite(resolve(dirname(worldPath), file), chunk)
    ))
  ];
  await Promise.all(writes);
  return {
    worldId,
    revision: prepared.world.revision,
    buildingId: prepared.buildingId,
    triangleCount: prepared.triangleCount,
    changedChunks: prepared.chunks.size,
    source: 'bundled',
    requiresFreshRoom: true
  };
}

async function publishBucketBuilding(
  worldId: string,
  rawDraft: unknown,
  actor: string
): Promise<BuildingPublicationResult> {
  const pointerKey = worldContentCurrentKey(worldId);
  const pointerRaw = await readBucketJson<unknown>(pointerKey);
  if (!pointerRaw) throw new BuildingPublicationError(503, `World "${worldId}" has no published base revision.`);
  const pointer = parseWorldContentPointer(pointerRaw, pointerKey);
  const baseManifest = await readRevisionManifest(worldId, pointer.revision);
  if (!baseManifest.checksums) {
    throw new BuildingPublicationError(503, 'The current world revision has no checksums and cannot be extended safely.');
  }
  const [rawManifest, world] = await Promise.all([
    readRevisionJson<unknown>(worldId, baseManifest, baseManifest.files.buildings),
    readRevisionJson<MutableGeometryWorld>(worldId, baseManifest, baseManifest.files.geometry)
  ]);
  const geometryRoot = dirname(baseManifest.files.geometry);
  const prepared = await preparePublication(rawDraft, rawManifest, world, async (file) => (
    readRevisionJson<MutableGeometryChunk>(worldId, baseManifest, `${geometryRoot}/${file}`)
  ));
  const overrides = new Map<string, Uint8Array>();
  overrides.set(baseManifest.files.buildings, jsonBytes(prepared.manifest));
  overrides.set(baseManifest.files.geometry, jsonBytes(prepared.world));
  for (const [file, chunk] of prepared.chunks) {
    overrides.set(`${geometryRoot}/${file}`, jsonBytes(chunk));
  }
  const checksums: Record<string, string> = {...baseManifest.checksums};
  for (const [path, body] of overrides) checksums[path] = sha256(body);
  const revisionHash = createHash('sha256').update(pointer.revision);
  for (const [path, body] of [...overrides].sort(([left], [right]) => left.localeCompare(right))) {
    revisionHash.update(path).update(sha256(body));
  }
  const revision = revisionHash.digest('hex').slice(0, 24);
  const publishedAt = new Date().toISOString();
  const manifest: WorldContentManifest = {
    schemaVersion: 1,
    engineSchemaVersion: 1,
    worldId,
    revision,
    publishedAt,
    baseRevision: pointer.revision,
    objects: [...overrides.keys()].sort(),
    files: baseManifest.files,
    checksums
  };
  const manifestKey = worldContentManifestKey(worldId, revision);
  if (!(await bucketObjectExists(manifestKey))) {
    await Promise.all([...overrides].map(([path, body]) => putBucketObject(
      worldContentAssetKey(worldId, revision, path),
      body,
      'application/json; charset=utf-8'
    )));
    await putBucketJson(manifestKey, manifest, 'public, max-age=31536000, immutable');
  }
  const latestRaw = await readBucketJson<unknown>(pointerKey);
  const latest = latestRaw ? parseWorldContentPointer(latestRaw, pointerKey) : undefined;
  if (latest?.revision !== pointer.revision) {
    throw new BuildingPublicationError(409, `World changed while ${actor} was publishing. Select the building again.`);
  }
  const nextPointer: WorldContentPointer = {schemaVersion: 1, worldId, revision, publishedAt};
  await putBucketJson(pointerKey, nextPointer, 'no-store');
  return {
    worldId,
    revision,
    buildingId: prepared.buildingId,
    triangleCount: prepared.triangleCount,
    changedChunks: prepared.chunks.size,
    source: 'bucket',
    requiresFreshRoom: true
  };
}

async function preparePublication(
  rawDraft: unknown,
  rawManifest: unknown,
  sourceWorld: MutableGeometryWorld,
  readChunk: (file: string) => Promise<MutableGeometryChunk>
): Promise<PreparedBuildingPublication> {
  let draft: BuildingAuthorDraft;
  let candidateManifest: BuildingManifest;
  try {
    draft = parseBuilderDraft(rawDraft);
    candidateManifest = promoteBuildingDraft(rawDraft, rawManifest, 1);
  } catch (error) {
    throw new BuildingPublicationError(400, error instanceof Error ? error.message : 'Invalid building draft.');
  }
  const candidate = candidateManifest.buildings.find(({id}) => id === draft.building.id);
  if (!candidate) throw new Error(`Promoted building "${draft.building.id}" is missing.`);
  const chunks = new Map<string, MutableGeometryChunk>();
  let triangleCount = 0;
  for (const descriptor of sourceWorld.chunks) {
    if (!geometryChunkOverlapsBuilding(descriptor, candidate)) continue;
    const result = partitionBuildingChunk(await readChunk(descriptor.file), candidate);
    if (result.triangleCount === 0) continue;
    chunks.set(descriptor.file, result.chunk);
    triangleCount += result.triangleCount;
  }
  if (triangleCount <= 0) throw new BuildingPublicationError(400, `Building "${candidate.id}" selected no roof geometry.`);
  const manifest = promoteBuildingDraft(rawDraft, rawManifest, triangleCount);
  const building = manifest.buildings.find(({id}) => id === candidate.id);
  if (!building) throw new Error(`Published building "${candidate.id}" is missing.`);
  const geometryRevision = `builder:${createHash('sha256')
    .update(sourceWorld.revision)
    .update(building.id)
    .update(JSON.stringify(building.shell.bounds))
    .digest('hex').slice(0, 20)}`;
  const world = addBuildingOccluder(sourceWorld, building, triangleCount, geometryRevision);
  return {buildingId: building.id, triangleCount, manifest, world, chunks};
}

async function readRevisionManifest(worldId: string, revision: string): Promise<WorldContentManifest> {
  const key = worldContentManifestKey(worldId, revision);
  const raw = await readBucketJson<unknown>(key);
  if (!raw) throw new BuildingPublicationError(503, `World content revision is missing ${key}.`);
  const manifest = parseWorldContentManifest(raw, key);
  if (manifest.worldId !== worldId || manifest.revision !== revision) {
    throw new BuildingPublicationError(503, 'World content manifest does not match its revision.');
  }
  return manifest;
}

async function readRevisionJson<T>(
  worldId: string,
  initialManifest: WorldContentManifest,
  path: string
): Promise<T> {
  let manifest = initialManifest;
  const visited = new Set<string>();
  while (visited.size < 16) {
    if (visited.has(manifest.revision)) throw new Error('World content revision inheritance contains a cycle.');
    visited.add(manifest.revision);
    if (!manifest.objects || manifest.objects.includes(path)) {
      const key = worldContentAssetKey(worldId, manifest.revision, path);
      const body = await readBucketObject(key);
      if (!body) throw new BuildingPublicationError(503, `World content asset is missing ${key}.`);
      const expected = initialManifest.checksums?.[path];
      if (expected && sha256(body) !== expected) throw new Error(`World content checksum mismatch for ${key}.`);
      return JSON.parse(new TextDecoder().decode(body)) as T;
    }
    if (!manifest.baseRevision) break;
    manifest = await readRevisionManifest(worldId, manifest.baseRevision);
  }
  throw new BuildingPublicationError(503, `World content asset "${path}" is unavailable.`);
}

async function readJsonFile<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T;
}

async function atomicJsonWrite(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, jsonBytes(value));
  await rename(temporary, path);
}

function jsonBytes(value: unknown): Uint8Array {
  return Buffer.from(`${JSON.stringify(value)}\n`);
}

function sha256(body: Uint8Array): string {
  return createHash('sha256').update(body).digest('hex');
}
