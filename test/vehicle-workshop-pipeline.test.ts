import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
import generatedCatalog from '../shared/content/vehicle-catalog.generated.json';
import {VEHICLE_SOURCE_FRAMES} from '../shared/content/vehicle-workshop.ts';
import {
  VEHICLE_SOURCE_ROOT,
  loadVehicleManifests,
  validateReadyManifestSet
} from '../src/tools/vehicle-pipeline/vehicle-manifest.ts';
import {validatePngFrame} from '../src/tools/vehicle-pipeline/vehicle-assets.ts';

test('vehicle manifests are the complete ordered source for generated runtime data', async () => {
  const manifests = await loadVehicleManifests();
  const ready = manifests
    .filter((manifest) => manifest.status === 'ready')
    .sort((a, b) => a.presentation.atlasRow - b.presentation.atlasRow);
  assert.deepEqual(validateReadyManifestSet(manifests), []);
  assert.deepEqual(generatedCatalog.order, ready.map((manifest) => manifest.id));
  assert.deepEqual(Object.keys(generatedCatalog.vehicles), generatedCatalog.order);
  for (const manifest of ready) {
    const generated = generatedCatalog.vehicles[manifest.id as keyof typeof generatedCatalog.vehicles];
    assert.equal(generated.presentation.frame, manifest.presentation.atlasRow);
    assert.deepEqual(generated.presentation.offsets, VEHICLE_SOURCE_FRAMES.map((frame) => (
      manifest.presentation.offsets[frame]
    )));
    assert.deepEqual(generated.presentation.lights, manifest.presentation.lights);
  }
});

test('every ready vehicle has five compiler-safe source frames', async () => {
  const manifests = await loadVehicleManifests();
  for (const manifest of manifests.filter((item) => item.status === 'ready')) {
    for (const frame of VEHICLE_SOURCE_FRAMES) {
      assert.deepEqual(
        await validatePngFrame(path.join(VEHICLE_SOURCE_ROOT, manifest.id, `${frame}.png`)),
        []
      );
    }
  }
});

test('vehicle image processor creates a valid transparent 96px candidate', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'nock0-vehicle-process-'));
  try {
    const output = path.join(directory, 'candidate.png');
    const result = spawnSync('python3', [
      'scripts/process-vehicle-sprite.py',
      '--input',
      'public/assets/custom/vehicles/suv/closed.png',
      '--output',
      output
    ], {encoding: 'utf8'});
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.deepEqual(await validatePngFrame(output), []);
    const bytes = await readFile(output);
    assert.equal(bytes[25], 6);
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});

test('canonical vehicle build reports committed outputs as current', () => {
  const result = spawnSync('npx', ['tsx', 'scripts/compile-vehicles.ts', '--check'], {encoding: 'utf8'});
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout) as {ok: boolean; vehicles: string[]};
  assert.equal(report.ok, true);
  assert.deepEqual(report.vehicles, generatedCatalog.order);
});
