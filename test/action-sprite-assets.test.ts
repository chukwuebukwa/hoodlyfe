import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

const assets = [
  ['player-actions.png', 288, 216],
  ['civilian-actions.png', 288, 216],
  ['police-actions.png', 288, 216],
  ['bloodstain.png', 256, 64],
  ['vehicle-doors.png', 480, 288]
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
