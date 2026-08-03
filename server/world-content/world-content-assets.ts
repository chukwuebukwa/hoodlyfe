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
  return signedBucketObjectUrl(worldContentAssetKey(worldId, revision, path));
}

export class WorldContentNotFoundError extends Error {}
