import {createHash} from 'node:crypto';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {DISTRICT_CATALOG} from '../../shared/content/district-catalog.ts';
import type {
  DistrictAssetManifest,
  EditorDraftEnvelope,
  EditorPlaytestRevision,
  EditorPublishedRevision,
  EditorPublishResponse
} from '../../shared/content/editor-production.ts';
import type {LevelEditorDocument} from '../../src/tools/level-editor/level-document.ts';
import {
  playtestBlockingValidationIssues,
  validateLevelDocument
} from '../../src/tools/level-editor/level-validation.ts';
import {
  bucketObjectExists,
  bucketStorageEnabled,
  putBucketJson,
  putBucketObject,
  readBucketJson,
  resolveBucketConfig,
  signedBucketObjectUrl,
  type BucketConfig
} from '../storage/bucket-object-store.ts';

export type EditorBucketConfig = BucketConfig;

export function resolveEditorBucketConfig(
  environment: Record<string, string | undefined> = process.env
): EditorBucketConfig | undefined {
  return resolveBucketConfig(environment);
}

export function editorStorageEnabled(): boolean {
  return bucketStorageEnabled();
}

export function districtDraftKey(districtId: string): string {
  return `editor/drafts/${assertDistrictId(districtId)}/latest.json`;
}

export function districtRevisionKey(districtId: string, revision: string): string {
  return `editor/revisions/${assertDistrictId(districtId)}/${assertRevision(revision)}.level.json`;
}

export function districtPublishedKey(districtId: string): string {
  return `editor/published/${assertDistrictId(districtId)}/current.json`;
}

export function districtAssetManifestKey(districtId: string): string {
  return `districts/${assertDistrictId(districtId)}/current.json`;
}

export async function readEditorDraft(districtId: string): Promise<EditorDraftEnvelope | undefined> {
  return readJson<EditorDraftEnvelope>(districtDraftKey(districtId));
}

export async function writeEditorDraft(
  districtId: string,
  document: LevelEditorDocument,
  actor: string
): Promise<EditorDraftEnvelope> {
  assertMatchingDistrict(districtId, document);
  const envelope: EditorDraftEnvelope = {
    schemaVersion: 1,
    districtId,
    revision: documentRevision(document),
    savedAt: new Date().toISOString(),
    actor,
    sourceFingerprint: sourceFingerprint(document),
    document
  };
  await putJson(districtDraftKey(districtId), envelope, 'no-store');
  return envelope;
}

export async function publishEditorRevision(
  districtId: string,
  document: LevelEditorDocument,
  actor: string
): Promise<EditorPublishResponse> {
  assertMatchingDistrict(districtId, document);
  const validation = validateLevelDocument(document);
  if (validation.counts.error > 0) {
    throw new EditorStorageError(422, `Revision has ${validation.counts.error} validation error${validation.counts.error === 1 ? '' : 's'}.`);
  }
  const revision = documentRevision(document);
  const documentKey = districtRevisionKey(districtId, revision);
  const unchanged = await objectExists(documentKey);
  if (!unchanged) await putJson(documentKey, document, 'public, max-age=31536000, immutable');
  const published: EditorPublishedRevision = {
    schemaVersion: 1,
    districtId,
    revision,
    publishedAt: new Date().toISOString(),
    actor,
    documentKey,
    sourceFingerprint: sourceFingerprint(document),
    validation: {errors: validation.counts.error, warnings: validation.counts.warning}
  };
  await putJson(districtPublishedKey(districtId), published, 'no-store');
  return {revision: published, unchanged};
}

export async function storeEditorPlaytestRevision(
  assetSourceId: string,
  document: LevelEditorDocument,
  actor: string
): Promise<{revision: EditorPlaytestRevision; unchanged: boolean}> {
  assertDistrictId(assetSourceId);
  const validation = validateLevelDocument(document);
  const blockingIssues = playtestBlockingValidationIssues(validation);
  if (blockingIssues.length > 0) {
    throw new EditorStorageError(
      422,
      `Playtest revision has ${blockingIssues.length} blocking validation error${blockingIssues.length === 1 ? '' : 's'}.`
    );
  }
  const revision = documentRevision(document);
  const documentKey = districtRevisionKey(assetSourceId, revision);
  const unchanged = editorStorageEnabled()
    ? await objectExists(documentKey)
    : await localRevisionExists(assetSourceId, revision);
  if (!unchanged) {
    if (editorStorageEnabled()) {
      await putJson(documentKey, document, 'private, max-age=31536000, immutable');
    } else {
      await writeLocalRevision(assetSourceId, revision, document);
    }
  }
  return {
    unchanged,
    revision: {
      schemaVersion: 1,
      assetSourceId,
      worldId: document.id,
      revision,
      createdAt: new Date().toISOString(),
      actor,
      documentKey,
      sourceFingerprint: sourceFingerprint(document),
      validation: {errors: validation.counts.error, warnings: validation.counts.warning}
    }
  };
}

export async function readEditorPlaytestRevision(
  assetSourceId: string,
  revision: string
): Promise<LevelEditorDocument | undefined> {
  assertDistrictId(assetSourceId);
  assertRevision(revision);
  return editorStorageEnabled()
    ? readJson<LevelEditorDocument>(districtRevisionKey(assetSourceId, revision))
    : readLocalRevision(assetSourceId, revision);
}

export async function bucketDistrictIds(): Promise<string[]> {
  if (!editorStorageEnabled()) return [];
  const checks = await Promise.all(DISTRICT_CATALOG.map(async (district) => (
    await objectExists(districtAssetManifestKey(district.id)) ? district.id : undefined
  )));
  return checks.filter((id): id is string => Boolean(id));
}

export async function readDistrictAssetManifest(districtId: string): Promise<DistrictAssetManifest | undefined> {
  return readJson<DistrictAssetManifest>(districtAssetManifestKey(districtId));
}

export async function signedDistrictAssetUrl(districtId: string, relativePath: string): Promise<string> {
  const manifest = await readDistrictAssetManifest(districtId);
  if (!manifest) throw new EditorStorageError(404, `District package ${districtId} is not stored in the editor bucket.`);
  const safePath = assertRelativeAssetPath(relativePath);
  return signedObjectUrl(`${manifest.prefix}/${safePath}`);
}

export async function putEditorObject(
  key: string,
  body: Uint8Array,
  contentType: string,
  cacheControl = 'public, max-age=31536000, immutable'
): Promise<void> {
  requireEditorStorage();
  await putBucketObject(key, body, contentType, cacheControl);
}

export async function putDistrictAssetManifest(manifest: DistrictAssetManifest): Promise<void> {
  await putJson(districtAssetManifestKey(manifest.districtId), manifest, 'no-store');
}

export class EditorStorageError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

async function putJson(key: string, value: unknown, cacheControl: string): Promise<void> {
  requireEditorStorage();
  await putBucketJson(key, value, cacheControl);
}

async function readJson<T>(key: string): Promise<T | undefined> {
  requireEditorStorage();
  return readBucketJson<T>(key);
}

async function objectExists(key: string): Promise<boolean> {
  requireEditorStorage();
  return bucketObjectExists(key);
}

async function signedObjectUrl(key: string): Promise<string> {
  requireEditorStorage();
  return signedBucketObjectUrl(key);
}

function requireEditorStorage(): void {
  if (!editorStorageEnabled()) {
    throw new EditorStorageError(503, 'Editor object storage is not configured.');
  }
}

export function documentRevision(document: LevelEditorDocument): string {
  return createHash('sha256').update(JSON.stringify(document)).digest('hex').slice(0, 20);
}

function sourceFingerprint(document: LevelEditorDocument): string {
  return [
    document.map.source,
    document.map.width,
    document.map.height,
    document.map.tileSize,
    document.map.origin.x,
    document.map.origin.y
  ].join(':');
}

function localRevisionPath(assetSourceId: string, revision: string): string {
  if (process.env.NODE_ENV === 'production') {
    throw new EditorStorageError(503, 'Authoritative Play Draft requires editor object storage in production.');
  }
  return resolve(
    process.cwd(),
    '.nock0',
    'editor',
    'revisions',
    assertDistrictId(assetSourceId),
    `${assertRevision(revision)}.level.json`
  );
}

async function localRevisionExists(assetSourceId: string, revision: string): Promise<boolean> {
  try {
    await readFile(localRevisionPath(assetSourceId, revision));
    return true;
  } catch (error) {
    if (isFileNotFound(error)) return false;
    throw error;
  }
}

async function writeLocalRevision(
  assetSourceId: string,
  revision: string,
  document: LevelEditorDocument
): Promise<void> {
  const path = localRevisionPath(assetSourceId, revision);
  await mkdir(dirname(path), {recursive: true});
  try {
    await writeFile(path, `${JSON.stringify(document)}\n`, {encoding: 'utf8', flag: 'wx'});
  } catch (error) {
    if (!isFileExists(error)) throw error;
  }
}

async function readLocalRevision(
  assetSourceId: string,
  revision: string
): Promise<LevelEditorDocument | undefined> {
  try {
    return JSON.parse(await readFile(localRevisionPath(assetSourceId, revision), 'utf8')) as LevelEditorDocument;
  } catch (error) {
    if (isFileNotFound(error)) return undefined;
    throw error;
  }
}

function assertMatchingDistrict(districtId: string, document: LevelEditorDocument): void {
  assertDistrictId(districtId);
  if (document.id !== districtId) throw new EditorStorageError(400, 'Document district does not match the request path.');
}

function assertDistrictId(districtId: string): string {
  if (!DISTRICT_CATALOG.some((district) => district.id === districtId)) {
    throw new EditorStorageError(404, `Unknown district: ${districtId}`);
  }
  return districtId;
}

function assertRevision(revision: string): string {
  if (!/^[a-f0-9]{12,64}$/.test(revision)) throw new EditorStorageError(400, 'Invalid revision id.');
  return revision;
}

function assertRelativeAssetPath(value: string): string {
  const decoded = decodeURIComponent(value);
  if (!decoded || decoded.startsWith('/') || decoded.includes('..') || decoded.includes('\\')) {
    throw new EditorStorageError(400, 'Invalid district asset path.');
  }
  return decoded;
}

function isFileNotFound(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && (error as {code?: string}).code === 'ENOENT');
}

function isFileExists(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && (error as {code?: string}).code === 'EEXIST');
}
