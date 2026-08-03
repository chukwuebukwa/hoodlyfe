import {createHash} from 'node:crypto';
import {readFile, readdir} from 'node:fs/promises';
import {extname, relative, resolve, sep} from 'node:path';
import {
  worldContentAssetKey,
  worldContentCurrentKey,
  worldContentManifestKey,
  type WorldContentManifest,
  type WorldContentPointer
} from '../shared/content/world-content.ts';
import {
  bucketObjectExists,
  bucketStorageEnabled,
  putBucketJson,
  putBucketObject
} from '../server/storage/bucket-object-store.ts';

const worldId = process.argv.find((value) => !value.startsWith('-') && value !== process.argv[0] && value !== process.argv[1]) ?? 'bil';
const dryRun = process.argv.includes('--dry-run');
if (worldId !== 'bil') throw new Error('The first world-content publisher supports the active BIL world only.');

const projectRoot = process.cwd();
const mapsRoot = resolve(projectRoot, 'public', 'assets', 'maps');
const buildingsPath = resolve(projectRoot, 'shared', 'content', 'buildings', 'buildings.json');
const mapPaths = await filesUnder(mapsRoot);
const sources = [
  ...mapPaths.map((absolutePath) => ({
    absolutePath,
    packagePath: `maps/${relative(mapsRoot, absolutePath).split(sep).join('/')}`
  })),
  {absolutePath: buildingsPath, packagePath: 'content/buildings.json'}
].sort((left, right) => left.packagePath.localeCompare(right.packagePath));

const assets = await Promise.all(sources.map(async ({absolutePath, packagePath}) => {
  const body = await readFile(absolutePath);
  return {
    packagePath,
    body,
    checksum: createHash('sha256').update(body).digest('hex'),
    contentType: contentTypeFor(packagePath)
  };
}));
const revisionHash = createHash('sha256');
for (const asset of assets) revisionHash.update(asset.packagePath).update(asset.checksum);
const revision = revisionHash.digest('hex').slice(0, 24);
const publishedAt = new Date().toISOString();
const manifest: WorldContentManifest = {
  schemaVersion: 1,
  engineSchemaVersion: 1,
  worldId,
  revision,
  publishedAt,
  files: {
    districtMap: 'maps/district-map.json',
    metadata: 'maps/district-map.metadata.json',
    surfaces: 'maps/surface-manifest.json',
    lanes: 'maps/district-lanes.json',
    geometry: 'maps/geometry/world.json',
    buildings: 'content/buildings.json'
  },
  checksums: Object.freeze(Object.fromEntries(assets.map(({packagePath, checksum}) => [packagePath, checksum])))
};
const pointer: WorldContentPointer = {
  schemaVersion: 1,
  worldId,
  revision,
  publishedAt
};
const totalBytes = assets.reduce((total, asset) => total + asset.body.byteLength, 0);

console.log(JSON.stringify({worldId, revision, files: assets.length, bytes: totalBytes, dryRun}, null, 2));
if (dryRun) process.exit(0);
if (!bucketStorageEnabled()) throw new Error('World publishing requires Railway bucket credentials.');

const manifestKey = worldContentManifestKey(worldId, revision);
if (!(await bucketObjectExists(manifestKey))) {
  await parallel(assets, 8, async (asset) => {
    await putBucketObject(
      worldContentAssetKey(worldId, revision, asset.packagePath),
      asset.body,
      asset.contentType
    );
  });
  await putBucketJson(manifestKey, manifest, 'public, max-age=31536000, immutable');
}
await putBucketJson(worldContentCurrentKey(worldId), pointer, 'no-store');
console.log(`Published ${worldId}@${revision} and advanced current.json.`);

async function filesUnder(directory: string): Promise<string[]> {
  const entries = await readdir(directory, {withFileTypes: true});
  const files = await Promise.all(entries.map((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? filesUnder(path) : [path];
  }));
  return files.flat();
}

async function parallel<T>(
  values: readonly T[],
  concurrency: number,
  run: (value: T) => Promise<void>
): Promise<void> {
  let index = 0;
  await Promise.all(Array.from({length: Math.min(concurrency, values.length)}, async () => {
    while (index < values.length) {
      const value = values[index++];
      await run(value);
    }
  }));
}

function contentTypeFor(path: string): string {
  switch (extname(path).toLowerCase()) {
    case '.json': return 'application/json; charset=utf-8';
    case '.png': return 'image/png';
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    case '.webp': return 'image/webp';
    default: return 'application/octet-stream';
  }
}
