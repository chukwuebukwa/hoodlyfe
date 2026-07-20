import type {LevelEditorDocument} from './level-document.ts';
import {databaseRequest, LEVEL_DRAFT_STORE, withToolStore} from './tool-database.ts';

interface DraftRecord {
  key: string;
  fingerprint: string;
  savedAt: string;
  document: LevelEditorDocument;
}

export async function loadLevelDraft(source: LevelEditorDocument): Promise<DraftRecord | undefined> {
  const record = await withToolStore<DraftRecord | undefined>(
    LEVEL_DRAFT_STORE,
    'readonly',
    (store) => databaseRequest(store.get(source.id))
  );
  if (!record || record.fingerprint !== fingerprint(source)) return undefined;
  return record;
}

export async function saveLevelDraft(document: LevelEditorDocument): Promise<string> {
  const savedAt = new Date().toISOString();
  const record: DraftRecord = {
    key: document.id,
    fingerprint: fingerprint(document),
    savedAt,
    document: structuredClone(document)
  };
  await withToolStore(LEVEL_DRAFT_STORE, 'readwrite', (store) => databaseRequest(store.put(record)));
  return savedAt;
}

export async function clearLevelDraft(documentId: string): Promise<void> {
  await withToolStore(LEVEL_DRAFT_STORE, 'readwrite', (store) => databaseRequest(store.delete(documentId)));
}

function fingerprint(document: LevelEditorDocument): string {
  return [
    document.map.source,
    document.map.width,
    document.map.height,
    document.map.tileSize,
    document.map.origin.x,
    document.map.origin.y
  ].join(':');
}
