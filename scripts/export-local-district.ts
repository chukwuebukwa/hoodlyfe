import {spawn} from 'node:child_process';
import {access, mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';

const districtId = process.argv[2]?.toLowerCase();
const cropSize = process.argv[3] ?? '256';

if (!districtId || !/^[a-z0-9_-]+$/.test(districtId)) {
  throw new Error('Usage: npm run district:export -- <district-id> [crop-size]');
}
if (!/^\d+$/.test(cropSize) || Number(cropSize) < 16 || Number(cropSize) > 256) {
  throw new Error('Crop size must be an integer from 16 through 256.');
}

const projectRoot = process.cwd();
const outputDirectory = resolve(projectRoot, 'public/assets/districts', districtId);
const exporter = resolve(projectRoot, 'scripts/export-gta2-assets.sh');
await mkdir(outputDirectory, {recursive: true});

await new Promise<void>((resolvePromise, reject) => {
  const child = spawn('bash', [exporter], {
    cwd: projectRoot,
    env: {
      ...process.env,
      GTA2_LEVEL: districtId,
      GTA2_CROP_SIZE: cropSize,
      OUTPUT_ASSETS_DIR: outputDirectory
    },
    stdio: 'inherit'
  });
  child.once('error', reject);
  child.once('exit', (code) => code === 0
    ? resolvePromise()
    : reject(new Error(`District export exited with status ${code ?? 'unknown'}.`)));
});

await Promise.all([
  access(resolve(outputDirectory, 'maps/district-map.json')),
  access(resolve(outputDirectory, 'maps/district-map.metadata.json')),
  access(resolve(outputDirectory, 'maps/district-preview.png')),
  access(resolve(outputDirectory, 'maps/geometry/world.json'))
]);

console.log(`District ${districtId.toUpperCase()} is available at /assets/districts/${districtId}.`);
