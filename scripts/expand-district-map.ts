import {spawnSync} from 'node:child_process';
import {
  cpSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {
  expansionDelta,
  generatedFrameSource,
  rebaseLaneDocument,
  type DistrictMapMetadata,
  type LaneDocument
} from './lib/district-map-expansion.ts';

const projectRoot = resolve(import.meta.dirname, '..');
const liveAssets = resolve(projectRoot, 'public', 'assets');
const liveMaps = resolve(liveAssets, 'maps');
const liveMetadataPath = resolve(liveMaps, 'district-map.metadata.json');
const liveLanesPath = resolve(liveMaps, 'district-lanes.json');
const generatedFramePath = resolve(
  projectRoot,
  'shared',
  'content',
  'district-map-frame.generated.ts'
);
const mapFiles = [
  'district-map.json',
  'district-map.metadata.json',
  'district-preview.png',
  'district-overlay.png',
  'district-tiles.png',
  'three/world.json',
  'three/tiles.png'
] as const;
const optionalMapFiles = ['three/prototype.json'] as const;
const mapDirectories = ['three/chunks'] as const;

const size = Number.parseInt(process.argv[2] ?? '', 10);
if (!Number.isInteger(size) || size < 16 || size > 256 || size % 8 !== 0) {
  throw new Error('Usage: npm run map:expand -- <crop-size>, using a multiple of 8 from 16 through 256.');
}

const temporaryRoot = mkdtempSync(join(tmpdir(), 'nock0-map-expansion-'));
const stagedAssets = resolve(temporaryRoot, 'staged-assets');
const backupRoot = resolve(temporaryRoot, 'backup');
const oldMetadata = readJson<DistrictMapMetadata>(liveMetadataPath);
const oldLanes = readJson<LaneDocument>(liveLanesPath);
let installed = false;

try {
  run('bash', ['scripts/export-gta2-assets.sh'], {
    ...process.env,
    GTA2_LEVEL: process.env.GTA2_LEVEL ?? oldMetadata.source,
    GTA2_CROP_SIZE: String(size),
    OUTPUT_ASSETS_DIR: stagedAssets,
    DOTNET_ARTIFACTS_DIR: resolve(temporaryRoot, 'dotnet-artifacts')
  });

  const stagedMaps = resolve(stagedAssets, 'maps');
  const newMetadata = readJson<DistrictMapMetadata>(
    resolve(stagedMaps, 'district-map.metadata.json')
  );
  if (newMetadata.size.width !== size || newMetadata.size.height !== size) {
    throw new Error(`Exporter returned ${newMetadata.size.width}x${newMetadata.size.height}, expected ${size}x${size}.`);
  }
  const delta = expansionDelta(oldMetadata, newMetadata);
  const rebasedLanes = rebaseLaneDocument(oldLanes, delta.x, delta.y);

  backupFile(liveLanesPath, resolve(backupRoot, 'district-lanes.json'));
  backupFile(generatedFramePath, resolve(backupRoot, 'district-map-frame.generated.ts'));
  for (const relativePath of [...mapFiles, ...optionalMapFiles]) {
    const stagedPath = resolve(stagedMaps, relativePath);
    if (mapFiles.includes(relativePath as typeof mapFiles[number]) && !existsSync(stagedPath)) {
      throw new Error(`Staged export is missing ${relativePath}.`);
    }
    backupIfPresent(resolve(liveMaps, relativePath), resolve(backupRoot, relativePath));
  }
  for (const relativePath of mapDirectories) {
    const stagedPath = resolve(stagedMaps, relativePath);
    if (!existsSync(stagedPath)) throw new Error(`Staged export is missing ${relativePath}.`);
    backupDirectoryIfPresent(resolve(liveMaps, relativePath), resolve(backupRoot, relativePath));
  }

  installed = true;
  for (const relativePath of mapFiles) {
    copyFile(resolve(stagedMaps, relativePath), resolve(liveMaps, relativePath));
  }
  for (const relativePath of optionalMapFiles) {
    const stagedPath = resolve(stagedMaps, relativePath);
    const livePath = resolve(liveMaps, relativePath);
    if (existsSync(stagedPath)) copyFile(stagedPath, livePath);
    else rmSync(livePath, {force: true});
  }
  for (const relativePath of mapDirectories) {
    installDirectory(resolve(stagedMaps, relativePath), resolve(liveMaps, relativePath));
  }
  writeFileSync(liveLanesPath, `${JSON.stringify(rebasedLanes, null, 2)}\n`);
  writeFileSync(generatedFramePath, generatedFrameSource(newMetadata));

  run(resolve(projectRoot, 'node_modules', '.bin', 'tsx'), [
    'scripts/validate-district-map.ts'
  ], process.env);

  console.log(
    `Expanded district ${oldMetadata.size.width}x${oldMetadata.size.height} -> ${size}x${size} tiles.`
  );
  console.log(
    `Source origin ${oldMetadata.origin.x}:${oldMetadata.origin.y} -> ` +
    `${newMetadata.origin.x}:${newMetadata.origin.y}; authored offset delta ${delta.x},${delta.y} px.`
  );
  console.log('Validation passed. Run npm test and npm run dev for complete QA.');
} catch (error) {
  if (installed) {
    restoreFile(resolve(backupRoot, 'district-lanes.json'), liveLanesPath);
    restoreFile(resolve(backupRoot, 'district-map-frame.generated.ts'), generatedFramePath);
    for (const relativePath of [...mapFiles, ...optionalMapFiles]) {
      restorePath(resolve(backupRoot, relativePath), resolve(liveMaps, relativePath));
    }
    for (const relativePath of mapDirectories) {
      restoreDirectory(resolve(backupRoot, relativePath), resolve(liveMaps, relativePath));
    }
    console.error('Expansion failed; restored the previous district assets.');
  }
  throw error;
} finally {
  rmSync(temporaryRoot, {recursive: true, force: true});
}

function backupFile(source: string, destination: string): void {
  if (!existsSync(source)) throw new Error(`Cannot back up missing file ${source}.`);
  copyFile(source, destination);
}

function backupIfPresent(source: string, destination: string): void {
  if (!existsSync(source)) return;
  copyFile(source, destination);
}

function backupDirectoryIfPresent(source: string, destination: string): void {
  if (!existsSync(source)) return;
  mkdirSync(dirname(destination), {recursive: true});
  cpSync(source, destination, {recursive: true});
}

function restoreFile(source: string, destination: string): void {
  copyFile(source, destination);
}

function restorePath(source: string, destination: string): void {
  if (existsSync(source)) copyFile(source, destination);
  else rmSync(destination, {force: true});
}

function restoreDirectory(source: string, destination: string): void {
  rmSync(destination, {recursive: true, force: true});
  if (existsSync(source)) cpSync(source, destination, {recursive: true});
}

function installDirectory(source: string, destination: string): void {
  rmSync(destination, {recursive: true, force: true});
  mkdirSync(dirname(destination), {recursive: true});
  cpSync(source, destination, {recursive: true});
}

function copyFile(source: string, destination: string): void {
  mkdirSync(dirname(destination), {recursive: true});
  copyFileSync(source, destination);
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function run(command: string, args: string[], env: NodeJS.ProcessEnv): void {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    env,
    stdio: 'inherit'
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} exited with status ${result.status}.`);
  }
}
