import {
  parseWorldContentManifest,
  worldContentAssetKey,
  worldContentManifestKey,
  type WorldContentManifest
} from '../../shared/content/world-content.ts';
import {
  readBucketJson,
  signedBucketObjectUrl
} from '../storage/bucket-object-store.ts';

const manifestCache = new Map<string, WorldContentManifest>();

export async function signedWorldContentAssetUrl(
  worldId: string,
  revision: string,
  path: string
): Promise<string> {
  const visited = new Set<string>();
  let candidateRevision = revision;
  while (visited.size < 16) {
    if (visited.has(candidateRevision)) throw new WorldContentNotFoundError('World content revision inheritance contains a cycle.');
    visited.add(candidateRevision);
    const manifest = await loadManifest(worldId, candidateRevision);
    if (!manifest.objects || manifest.objects.includes(path)) {
      return signedBucketObjectUrl(worldContentAssetKey(worldId, candidateRevision, path));
    }
    if (!manifest.baseRevision) break;
    candidateRevision = manifest.baseRevision;
  }
  throw new WorldContentNotFoundError(`World content asset "${path}" is not present in revision ${revision}.`);
}

async function loadManifest(worldId: string, revision: string): Promise<WorldContentManifest> {
  const manifestKey = worldContentManifestKey(worldId, revision);
  let manifest = manifestCache.get(manifestKey);
  if (!manifest) {
    const raw = await readBucketJson<unknown>(manifestKey);
    if (!raw) throw new WorldContentNotFoundError(`World content revision is missing ${manifestKey}.`);
    manifest = parseWorldContentManifest(raw, manifestKey);
    manifestCache.set(manifestKey, manifest);
  }
  if (manifest.worldId !== worldId || manifest.revision !== revision) {
    throw new WorldContentNotFoundError('World content manifest does not match the requested revision.');
  }
  return manifest;
}

export class WorldContentNotFoundError extends Error {}
