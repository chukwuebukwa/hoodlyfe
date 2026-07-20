import {
  isCompatiblePlaytestRevision,
  type LocalPlaytestRevision
} from './playtest-revision.ts';
import type {LevelEditorDocument} from './level-document.ts';
import {
  databaseRequest,
  PLAYTEST_REVISION_ID_INDEX,
  PLAYTEST_REVISION_STORE,
  withToolStore
} from './tool-database.ts';

interface StoredPlaytestRevision extends LocalPlaytestRevision {
  key: string;
}

const MAX_LOCAL_REVISIONS_PER_DISTRICT = 12;

export async function saveLocalPlaytestRevision(
  revision: LocalPlaytestRevision
): Promise<void> {
  const stored: StoredPlaytestRevision = {
    ...structuredClone(revision),
    key: revisionKey(revision.districtId, revision.revisionId)
  };
  await withToolStore(
    PLAYTEST_REVISION_STORE,
    'readwrite',
    (store) => databaseRequest(store.put(stored))
  );
  await pruneDistrictRevisions(revision.districtId);
}

export async function loadLocalPlaytestRevision(
  revisionId: string,
  source?: LevelEditorDocument
): Promise<LocalPlaytestRevision | undefined> {
  const stored = await withToolStore<StoredPlaytestRevision | undefined>(
    PLAYTEST_REVISION_STORE,
    'readonly',
    (store) => databaseRequest(store.index(PLAYTEST_REVISION_ID_INDEX).get(revisionId))
  );
  if (
    !stored ||
    stored.revisionId !== revisionId ||
    (source && !isCompatiblePlaytestRevision(stored, source))
  ) {
    return undefined;
  }
  const {key: _key, ...revision} = stored;
  return revision;
}

async function pruneDistrictRevisions(districtId: string): Promise<void> {
  await withToolStore(PLAYTEST_REVISION_STORE, 'readwrite', async (store) => {
    const records = await databaseRequest<StoredPlaytestRevision[]>(store.getAll());
    const stale = records
      .filter((record) => record.districtId === districtId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(MAX_LOCAL_REVISIONS_PER_DISTRICT);
    await Promise.all(stale.map((record) => databaseRequest(store.delete(record.key))));
  });
}

function revisionKey(districtId: string, revisionId: string): string {
  return `${districtId}:${revisionId}`;
}
