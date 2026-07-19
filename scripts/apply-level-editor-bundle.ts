import {mkdir, readFile, rename, rm, writeFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {
  assembleLevelDocument,
  isLevelEditorBundle,
  type LevelEditorBundle
} from '../src/tools/level-editor/level-document.ts';
import {validateLevelDocument} from '../src/tools/level-editor/level-validation.ts';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argument = process.argv.slice(2).find((value) => !value.startsWith('--'));
const checkOnly = process.argv.includes('--check');
const allowErrors = process.argv.includes('--force');

if (!argument) {
  throw new Error('Usage: npm run level:apply -- path/to/district.game-bundle.json [--check] [--force]');
}

const bundlePath = resolve(process.cwd(), argument);
const parsed = JSON.parse(await readFile(bundlePath, 'utf8')) as unknown;
if (!isLevelEditorBundle(parsed)) throw new Error(`${bundlePath} is not a supported NOCK0 level editor bundle.`);

validateBundle(parsed);
const report = validateLevelDocument(parsed.editorDocument);
if (report.counts.error > 0 && !allowErrors) {
  const messages = report.issues
    .filter((issue) => issue.severity === 'error')
    .map((issue) => `${issue.code}: ${issue.message}`);
  throw new Error(`Bundle has ${report.counts.error} validation error(s):\n- ${messages.join('\n- ')}\nPass --force only for deliberate recovery work.`);
}

if (checkOnly) {
  console.log(`Level bundle valid: ${parsed.editorDocument.id}, ${report.counts.warning} warning(s).`);
  process.exit(0);
}

for (const [relativePath, value] of Object.entries(parsed.files)) {
  const outputPath = resolve(projectRoot, relativePath);
  if (!outputPath.startsWith(`${projectRoot}/`)) throw new Error(`Unsafe bundle output path: ${relativePath}`);
  await atomicWriteJson(outputPath, value);
  console.log(`Wrote ${relativePath}`);
}

console.log('Level bundle applied. Run npm run map:validate, npm test, and npm run build before committing.');

function validateBundle(bundle: LevelEditorBundle): void {
  const map = bundle.files['public/assets/maps/district-map.json'];
  const metadata = bundle.files['public/assets/maps/district-map.metadata.json'];
  const lanes = bundle.files['public/assets/maps/district-lanes.json'];
  const assembled = assembleLevelDocument(map, metadata, lanes);
  if (
    assembled.map.width !== bundle.editorDocument.map.width ||
    assembled.map.height !== bundle.editorDocument.map.height ||
    assembled.map.tileSize !== bundle.editorDocument.map.tileSize
  ) throw new Error('Bundle editor document and emitted game files use different map contracts.');
  if (!arraysEqual(assembled.layers.collision, bundle.editorDocument.layers.collision)) {
    throw new Error('Bundle collision layer does not match its editor document.');
  }
  if (!arraysEqual(assembled.layers.roads, bundle.editorDocument.layers.roads)) {
    throw new Error('Bundle road layer does not match its editor document.');
  }
  if (!sameJson(assembled.lanes, bundle.editorDocument.lanes)) {
    throw new Error('Bundle lane graph does not match its editor document.');
  }
  const playerSpawn = bundle.editorDocument.spawns.find((spawn) => spawn.kind === 'player' && spawn.enabled);
  if (playerSpawn && (
    metadata.spawn.x !== Math.round(playerSpawn.x) ||
    metadata.spawn.y !== Math.round(playerSpawn.y)
  )) {
    throw new Error('Bundle runtime player spawn does not match its editor document.');
  }
}

function arraysEqual(left: number[], right: number[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function atomicWriteJson(outputPath: string, value: unknown): Promise<void> {
  const temporaryPath = `${outputPath}.level-editor-${process.pid}.tmp`;
  await mkdir(dirname(outputPath), {recursive: true});
  try {
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await rename(temporaryPath, outputPath);
  } finally {
    await rm(temporaryPath, {force: true});
  }
}
