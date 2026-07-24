import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
import {
  VEHICLE_DOOR_COLUMNS,
  VEHICLE_DOOR_ROWS
} from '../src/game/rendering/action-sprite-policy.ts';
import {VEHICLE_KINDS} from '../shared/content/vehicle-catalog.ts';

const assets = [
  ['player-actions.png', 288, 216],
  ['civilian-actions.png', 288, 216],
  ['police-actions.png', 288, 216],
  ['bloodstain.png', 256, 64]
] as const;

for (const [name, expectedWidth, expectedHeight] of assets) {
  test(`${name} keeps its renderer atlas dimensions`, async () => {
    const png = await readFile(new URL(`../public/assets/custom/actions/${name}`, import.meta.url));
    assert.equal(png.subarray(1, 4).toString('ascii'), 'PNG');
    assert.equal(png.readUInt32BE(16), expectedWidth);
    assert.equal(png.readUInt32BE(20), expectedHeight);
    assert.equal(png[25], 6, 'asset must be RGBA');
  });
}

test('vehicles.png keeps its renderer atlas dimensions', async () => {
  const png = await readFile(new URL('../public/assets/original/sprites/vehicles.png', import.meta.url));
  assert.equal(png.subarray(1, 4).toString('ascii'), 'PNG');
  assert.equal(png.readUInt32BE(16), 480);
  assert.equal(png.readUInt32BE(20), 96);
  assert.equal(png[25], 6, 'asset must be RGBA');
});

test('vehicle-doors.png matches the live vehicle catalog row contract', async () => {
  const png = await readFile(new URL('../public/assets/custom/actions/vehicle-doors.png', import.meta.url));
  assert.equal(png.subarray(1, 4).toString('ascii'), 'PNG');
  assert.equal(png.readUInt32BE(16), VEHICLE_DOOR_COLUMNS * 96);
  assert.equal(png.readUInt32BE(20), VEHICLE_DOOR_ROWS * 96);
  assert.equal(png[25], 6, 'asset must be RGBA');
  assert.equal(VEHICLE_DOOR_ROWS, VEHICLE_KINDS.length);
});

test('vehicle door atlas is reproducible from source frame folders', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nock0-vehicle-atlas-'));
  try {
    const output = join(directory, 'vehicle-doors.png');
    const result = spawnSync('python3', [
      'scripts/build-vehicle-door-atlas.py',
      '--output',
      output
    ], {encoding: 'utf8'});
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const expected = await readFile(new URL('../public/assets/custom/actions/vehicle-doors.png', import.meta.url));
    const actual = await readFile(output);
    assert.deepEqual(actual, expected);
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});
