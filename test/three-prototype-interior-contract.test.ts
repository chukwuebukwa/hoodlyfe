import assert from 'node:assert/strict';
import {existsSync, readFileSync} from 'node:fs';
import test from 'node:test';
import {INTERIORS} from '../shared/content/interior-catalog.ts';

const prototypePath = 'public/assets/maps/three/prototype.json';

test('exported roof groups match the authoritative interior catalog', {
  skip: !existsSync(prototypePath)
}, () => {
  const payload = JSON.parse(readFileSync(prototypePath, 'utf8')) as {
    version: number;
    blockSize: number;
    occluders: Array<{
      id: string;
      exteriorDoor: {x: number; y: number};
      floorZ: number;
      triangleCount: number;
    }>;
  };
  assert.equal(payload.version, 2);
  assert.deepEqual(
    payload.occluders.map((occluder) => occluder.id).sort(),
    INTERIORS.map((interior) => interior.id).sort()
  );
  for (const interior of INTERIORS) {
    const occluder = payload.occluders.find((candidate) => candidate.id === interior.id);
    assert.ok(occluder, `Missing exported roof group: ${interior.id}`);
    assert.ok(occluder.triangleCount > 0);
    assert.ok(Math.abs(occluder.exteriorDoor.x * payload.blockSize - interior.exteriorDoor.x) <= 1);
    assert.ok(Math.abs(occluder.exteriorDoor.y * payload.blockSize - interior.exteriorDoor.y) <= 1);
    assert.ok(Math.abs(occluder.floorZ * payload.blockSize - interior.floorZ) <= 1);
  }
});
