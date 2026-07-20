import type {LevelEditorDocument} from '../../src/tools/level-editor/level-document.ts';

export interface EditorDraftEnvelope {
  schemaVersion: 1;
  districtId: string;
  revision: string;
  savedAt: string;
  actor: string;
  sourceFingerprint: string;
  document: LevelEditorDocument;
}

export interface EditorPublishedRevision {
  schemaVersion: 1;
  districtId: string;
  revision: string;
  publishedAt: string;
  actor: string;
  documentKey: string;
  sourceFingerprint: string;
  validation: {errors: number; warnings: number};
}

export interface DistrictAssetManifest {
  schemaVersion: 1;
  districtId: string;
  revision: string;
  publishedAt: string;
  prefix: string;
  fileCount: number;
  bytes: number;
}

export interface EditorCatalogResponse {
  storageEnabled: boolean;
  bucketDistrictIds: string[];
}

export interface EditorPublishResponse {
  revision: EditorPublishedRevision;
  unchanged: boolean;
}

export interface EditorPlaytestRevision {
  schemaVersion: 1;
  assetSourceId: string;
  worldId: string;
  revision: string;
  createdAt: string;
  actor: string;
  documentKey: string;
  sourceFingerprint: string;
  validation: {errors: number; warnings: number};
}

export interface EditorPlaytestResponse {
  revision: EditorPlaytestRevision;
  unchanged: boolean;
  roomName: 'district-playtest';
  token: string;
  playUrl: string;
  warnings: string[];
}
