import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const ICONS = ['ammunition', 'clothing', 'hospital', 'repair'] as const;

test('generated minimap location sprites are uniform transparent RGBA assets', () => {
  for (const kind of ICONS) {
    const png = readFileSync(`public/assets/custom/minimap/location-${kind}.png`);
    assert.equal(png.subarray(1, 4).toString('ascii'), 'PNG');
    assert.equal(png.readUInt32BE(16), 64, `${kind} icon width changed.`);
    assert.equal(png.readUInt32BE(20), 64, `${kind} icon height changed.`);
    assert.equal(png[25], 6, `${kind} icon must remain RGBA.`);
  }
});
