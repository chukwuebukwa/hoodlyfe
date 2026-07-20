export const LEVEL_DRAFT_STORE = 'level-editor-drafts';
export const PLAYTEST_REVISION_STORE = 'level-playtest-revisions';
export const PLAYTEST_REVISION_ID_INDEX = 'by-revision-id';

const DATABASE_NAME = 'nock0-tools';
const DATABASE_VERSION = 3;

export async function withToolStore<T>(
  storeName: typeof LEVEL_DRAFT_STORE | typeof PLAYTEST_REVISION_STORE,
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => Promise<T>
): Promise<T> {
  const database = await openToolDatabase();
  try {
    const transaction = database.transaction(storeName, mode);
    const result = await operation(transaction.objectStore(storeName));
    await transactionDone(transaction);
    return result;
  } finally {
    database.close();
  }
}

export function databaseRequest<T>(value: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    value.addEventListener('success', () => resolve(value.result));
    value.addEventListener('error', () => reject(value.error ?? new Error('Editor database request failed.')));
  });
}

function openToolDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    open.addEventListener('upgradeneeded', () => {
      const database = open.result;
      if (!database.objectStoreNames.contains(LEVEL_DRAFT_STORE)) {
        database.createObjectStore(LEVEL_DRAFT_STORE, {keyPath: 'key'});
      }
      const revisionStore = database.objectStoreNames.contains(PLAYTEST_REVISION_STORE)
        ? open.transaction?.objectStore(PLAYTEST_REVISION_STORE)
        : database.createObjectStore(PLAYTEST_REVISION_STORE, {keyPath: 'key'});
      if (revisionStore && !revisionStore.indexNames.contains(PLAYTEST_REVISION_ID_INDEX)) {
        revisionStore.createIndex(PLAYTEST_REVISION_ID_INDEX, 'revisionId', {unique: true});
      }
    });
    open.addEventListener('success', () => resolve(open.result));
    open.addEventListener('error', () => reject(open.error ?? new Error('Unable to open editor database.')));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.addEventListener('complete', () => resolve());
    transaction.addEventListener('abort', () => reject(transaction.error ?? new Error('Editor database transaction aborted.')));
    transaction.addEventListener('error', () => reject(transaction.error ?? new Error('Editor database transaction failed.')));
  });
}
