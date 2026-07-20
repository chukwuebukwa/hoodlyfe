import type {LevelEditorDocument} from './level-document.ts';

export const LOCAL_PLAYTEST_SCHEMA_VERSION = 1;

export interface LocalPlaytestRevision {
  schemaVersion: typeof LOCAL_PLAYTEST_SCHEMA_VERSION;
  revisionId: string;
  districtId: string;
  createdAt: string;
  sourceFingerprint: string;
  document: LevelEditorDocument;
}

export async function createLocalPlaytestRevision(
  document: LevelEditorDocument,
  createdAt = new Date().toISOString()
): Promise<LocalPlaytestRevision> {
  const snapshot = structuredClone(document);
  return {
    schemaVersion: LOCAL_PLAYTEST_SCHEMA_VERSION,
    revisionId: await hashLevelDocument(snapshot),
    districtId: snapshot.id,
    createdAt,
    sourceFingerprint: levelSourceFingerprint(snapshot),
    document: snapshot
  };
}

export async function hashLevelDocument(document: LevelEditorDocument): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(document));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 24);
}

export function levelSourceFingerprint(document: LevelEditorDocument): string {
  return [
    document.map.source,
    document.map.width,
    document.map.height,
    document.map.tileSize,
    document.map.origin.x,
    document.map.origin.y
  ].join(':');
}

export function isCompatiblePlaytestRevision(
  revision: LocalPlaytestRevision,
  source: LevelEditorDocument
): boolean {
  return revision.schemaVersion === LOCAL_PLAYTEST_SCHEMA_VERSION &&
    revision.districtId === source.id &&
    revision.sourceFingerprint === levelSourceFingerprint(source);
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => (
    `${JSON.stringify(key)}:${canonicalJson(record[key])}`
  )).join(',')}}`;
}
