import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {
  coloredBeaconHex,
  isColoredBeaconDefinition,
  parseColoredBeaconDefinitions
} from '../shared/content/colored-beacons.ts';

test('district colored beacons use valid scalable fixture data', async () => {
  const source = JSON.parse(
    await readFile('public/assets/maps/district-beacons.json', 'utf8')
  ) as unknown;
  const beacons = parseColoredBeaconDefinitions(source);

  assert.equal(beacons.length, 2);
  assert.deepEqual(beacons.map(({id}) => id), ['repair-entrance', 'repair-alley']);
  assert.equal(beacons.every(isColoredBeaconDefinition), true);
  assert.equal(beacons.every(({color}) => coloredBeaconHex(color) === 0x20dcff), true);
  assert.equal(new Set(beacons.map(({id}) => id)).size, beacons.length);
});

test('colored beacon parsing ignores malformed fixtures', () => {
  assert.deepEqual(parseColoredBeaconDefinitions([
    {
      id: 'bad',
      label: 'Bad',
      enabled: true,
      x: 0,
      y: 0,
      z: 10,
      targetX: 10,
      targetY: 10,
      targetZ: 0,
      color: 'cyan',
      intensity: 1,
      radius: 10,
      footprintWidth: 10,
      footprintHeight: 10
    }
  ]), []);
});
