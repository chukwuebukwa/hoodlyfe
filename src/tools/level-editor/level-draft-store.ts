import type {LevelEditorDocument} from './level-document.ts';

interface DraftRecord {
  key: string;
  fingerprint: string;
  savedAt: string;
  document: LevelEditorDocument;
}

const DATABASE_NAME = 'nock0-tools';
const DATABASE_VERSION = 1;
const STORE_NAME = 'level-editor-drafts';

export async function loadLevelDraft(source: LevelEditorDocument): Promise<DraftRecord | undefined> {
  const record = await withStore<DraftRecord | undefined>('readonly', (store) => request(store.get(source.id)));
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
  await withStore('readwrite', (store) => request(store.put(record)));
  return savedAt;
}

export async function clearLevelDraft(documentId: string): Promise<void> {
  await withStore('readwrite', (store) => request(store.delete(documentId)));
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

async function withStore<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => Promise<T>
): Promise<T> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, mode);
    const result = await operation(transaction.objectStore(STORE_NAME));
    await transactionDone(transaction);
    return result;
  } finally {
    database.close();
  }
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    open.addEventListener('upgradeneeded', () => {
      const database = open.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) database.createObjectStore(STORE_NAME, {keyPath: 'key'});
    });
    open.addEventListener('success', () => resolve(open.result));
    open.addEventListener('error', () => reject(open.error ?? new Error('Unable to open editor draft database.')));
  });
}

function request<T>(value: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    value.addEventListener('success', () => resolve(value.result));
    value.addEventListener('error', () => reject(value.error ?? new Error('Editor draft database request failed.')));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.addEventListener('complete', () => resolve());
    transaction.addEventListener('abort', () => reject(transaction.error ?? new Error('Editor draft transaction aborted.')));
    transaction.addEventListener('error', () => reject(transaction.error ?? new Error('Editor draft transaction failed.')));
  });
}
