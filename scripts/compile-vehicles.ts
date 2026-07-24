import {spawn} from 'node:child_process';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {
  VEHICLE_DOOR_ATLAS,
  VEHICLE_GENERATED_CATALOG,
  VEHICLE_SOURCE_ROOT,
  loadVehicleManifests,
  validateReadyManifestSet
} from '../src/tools/vehicle-pipeline/vehicle-manifest.ts';
import {validatePngFrame} from '../src/tools/vehicle-pipeline/vehicle-assets.ts';
import {
  VEHICLE_SOURCE_FRAMES,
  type VehicleBuildReport,
  type VehicleWorkshopManifest
} from '../shared/content/vehicle-workshop.ts';

const checkOnly = process.argv.includes('--check');

async function main(): Promise<void> {
  const manifests = await loadVehicleManifests();
  const ready = manifests
    .filter((manifest) => manifest.status === 'ready')
    .sort((a, b) => a.presentation.atlasRow - b.presentation.atlasRow);
  const errors = validateReadyManifestSet(manifests);
  for (const manifest of ready) {
    for (const frame of VEHICLE_SOURCE_FRAMES) {
      errors.push(...await validatePngFrame(path.join(VEHICLE_SOURCE_ROOT, manifest.id, `${frame}.png`)));
    }
  }
  if (errors.length) throw new Error(errors.join('\n'));

  const generated = generatedCatalog(ready);
  const generatedJson = `${JSON.stringify(generated, null, 2)}\n`;
  if (checkOnly) {
    const temp = await mkdtemp(path.join(tmpdir(), 'nock0-vehicle-build-'));
    try {
      const atlasOutput = path.join(temp, 'vehicle-doors.png');
      await runPythonAtlas(atlasOutput);
      await assertCurrent(VEHICLE_GENERATED_CATALOG, Buffer.from(generatedJson), 'generated vehicle catalog');
      await assertCurrent(VEHICLE_DOOR_ATLAS, await readFile(atlasOutput), 'vehicle door atlas');
    } finally {
      await rm(temp, {recursive: true, force: true});
    }
  } else {
    await writeFile(VEHICLE_GENERATED_CATALOG, generatedJson);
    await runPythonAtlas(VEHICLE_DOOR_ATLAS);
  }

  const report: VehicleBuildReport = {
    ok: true,
    builtAt: new Date().toISOString(),
    atlas: path.relative(process.cwd(), VEHICLE_DOOR_ATLAS),
    generatedCatalog: path.relative(process.cwd(), VEHICLE_GENERATED_CATALOG),
    vehicles: ready.map((manifest) => manifest.id),
    warnings: manifests
      .filter((manifest) => manifest.status === 'draft')
      .map((manifest) => `Skipped draft vehicle ${manifest.id}.`),
    errors: []
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

function generatedCatalog(manifests: VehicleWorkshopManifest[]) {
  return {
    version: 1,
    order: manifests.map((manifest) => manifest.id),
    vehicles: Object.fromEntries(manifests.map((manifest) => [manifest.id, {
      id: manifest.id,
      label: manifest.label,
      class: manifest.class,
      seats: manifest.seats,
      radius: manifest.radius,
      maxHealth: manifest.maxHealth,
      mass: manifest.mass,
      collisionDamageScale: manifest.collisionDamageScale,
      collision: manifest.collision,
      handling: manifest.handling,
      traffic: manifest.traffic,
      population: manifest.population,
      presentation: {
        frame: manifest.presentation.atlasRow,
        width: manifest.presentation.width,
        height: manifest.presentation.height,
        emergencyLights: manifest.presentation.emergencyLights,
        offsets: VEHICLE_SOURCE_FRAMES.map((frame) => manifest.presentation.offsets[frame])
      }
    }]))
  };
}

async function runPythonAtlas(output: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn('python3', [
      'scripts/build-vehicle-door-atlas.py',
      '--source-root',
      path.relative(process.cwd(), VEHICLE_SOURCE_ROOT),
      '--output',
      output
    ], {cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe']});
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr || stdout || `Vehicle atlas builder exited ${code}.`));
    });
  });
}

async function assertCurrent(filePath: string, expected: Buffer, label: string): Promise<void> {
  let current: Buffer;
  try {
    current = await readFile(filePath);
  } catch {
    throw new Error(`${label} is missing. Run npm run vehicles:build.`);
  }
  if (!current.equals(expected)) {
    throw new Error(`${label} is stale. Run npm run vehicles:build and commit the generated output.`);
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
