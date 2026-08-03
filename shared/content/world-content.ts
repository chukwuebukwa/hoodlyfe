export type WorldContentSource = 'bundled' | 'bucket';

export interface WorldContentPointer {
  readonly schemaVersion: 1;
  readonly worldId: string;
  readonly revision: string;
  readonly publishedAt: string;
}

export interface WorldContentFiles {
  readonly districtMap: string;
  readonly metadata: string;
  readonly surfaces: string;
  readonly lanes: string;
  readonly geometry: string;
  readonly buildings: string;
}

export interface WorldContentManifest extends WorldContentPointer {
  readonly engineSchemaVersion: 1;
  readonly baseRevision?: string;
  readonly objects?: readonly string[];
  readonly files: WorldContentFiles;
  readonly checksums?: Readonly<Record<string, string>>;
}

export interface WorldContentDescriptor {
  readonly schemaVersion: 1;
  readonly worldId: string;
  readonly revision: string;
  readonly source: WorldContentSource;
  readonly assetRoot: string;
  readonly buildingsPath: string;
}

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,63}$/;
const REVISION_PATTERN = /^[a-z0-9][a-z0-9._:-]{5,127}$/i;

export function parseWorldContentPointer(raw: unknown, source = 'current.json'): WorldContentPointer {
  const value = record(raw, source);
  if (value.schemaVersion !== 1) throw new Error(`${source}: schemaVersion must be 1.`);
  const worldId = identifier(value.worldId, `${source}.worldId`);
  const revision = revisionId(value.revision, `${source}.revision`);
  const publishedAt = requiredString(value.publishedAt, `${source}.publishedAt`);
  if (Number.isNaN(Date.parse(publishedAt))) throw new Error(`${source}.publishedAt must be an ISO timestamp.`);
  return Object.freeze({schemaVersion: 1, worldId, revision, publishedAt});
}

export function parseWorldContentManifest(raw: unknown, source = 'manifest.json'): WorldContentManifest {
  const pointer = parseWorldContentPointer(raw, source);
  const value = record(raw, source);
  if (value.engineSchemaVersion !== 1) throw new Error(`${source}: engineSchemaVersion must be 1.`);
  const rawFiles = record(value.files, `${source}.files`);
  const files: WorldContentFiles = Object.freeze({
    districtMap: relativePath(rawFiles.districtMap, `${source}.files.districtMap`),
    metadata: relativePath(rawFiles.metadata, `${source}.files.metadata`),
    surfaces: relativePath(rawFiles.surfaces, `${source}.files.surfaces`),
    lanes: relativePath(rawFiles.lanes, `${source}.files.lanes`),
    geometry: relativePath(rawFiles.geometry, `${source}.files.geometry`),
    buildings: relativePath(rawFiles.buildings, `${source}.files.buildings`)
  });
  const checksums = value.checksums === undefined
    ? undefined
    : Object.freeze(Object.fromEntries(Object.entries(record(value.checksums, `${source}.checksums`))
      .map(([path, checksum]) => [
        relativePath(path, `${source}.checksums key`),
        sha256(checksum, `${source}.checksums.${path}`)
      ])));
  const baseRevision = value.baseRevision === undefined
    ? undefined
    : revisionId(value.baseRevision, `${source}.baseRevision`);
  if (baseRevision === pointer.revision) throw new Error(`${source}.baseRevision cannot reference itself.`);
  const objects = value.objects === undefined
    ? undefined
    : Object.freeze(array(value.objects, `${source}.objects`).map((path, index) => (
      relativePath(path, `${source}.objects[${index}]`)
    )));
  if (objects && !baseRevision) throw new Error(`${source}.objects requires baseRevision.`);
  return Object.freeze({...pointer, engineSchemaVersion: 1, baseRevision, objects, files, checksums});
}

export function worldContentCurrentKey(worldId: string): string {
  return `worlds/${identifier(worldId, 'worldId')}/current.json`;
}

export function worldContentManifestKey(worldId: string, revision: string): string {
  return `${worldContentRevisionPrefix(worldId, revision)}/manifest.json`;
}

export function worldContentAssetKey(worldId: string, revision: string, path: string): string {
  return `${worldContentRevisionPrefix(worldId, revision)}/${relativePath(path, 'asset path')}`;
}

function worldContentRevisionPrefix(worldId: string, revision: string): string {
  return `worlds/${identifier(worldId, 'worldId')}/revisions/${revisionId(revision, 'revision')}`;
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${path} must be an object.`);
  return value as Record<string, unknown>;
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array.`);
  return value;
}

function requiredString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${path} must be a string.`);
  return value;
}

function identifier(value: unknown, path: string): string {
  const result = requiredString(value, path);
  if (!ID_PATTERN.test(result)) throw new Error(`${path} is invalid.`);
  return result;
}

function revisionId(value: unknown, path: string): string {
  const result = requiredString(value, path);
  if (!REVISION_PATTERN.test(result)) throw new Error(`${path} is invalid.`);
  return result;
}

function relativePath(value: unknown, path: string): string {
  const result = requiredString(value, path);
  if (result.startsWith('/') || result.includes('..') || result.includes('\\')) {
    throw new Error(`${path} must be a safe relative path.`);
  }
  return result;
}

function sha256(value: unknown, path: string): string {
  const result = requiredString(value, path);
  if (!/^[a-f0-9]{64}$/i.test(result)) throw new Error(`${path} must be a SHA-256 digest.`);
  return result.toLowerCase();
}
