import assert from 'node:assert/strict';
import {existsSync, readFileSync} from 'node:fs';
import test from 'node:test';
import {INTERIORS} from '../shared/content/interior-catalog.ts';

const manifestPath = 'public/assets/maps/three/world.json';

test('streamed roof groups match the authoritative interior catalog', {
  skip: !existsSync(manifestPath)
}, () => {
  const payload = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    version: number;
    blockSize: number;
    chunks: Array<{file: string}>;
    occluders: Array<{
      id: string;
      exteriorDoor: {x: number; y: number};
      floorZ: number;
      triangleCount: number;
    }>;
  };
  assert.equal(payload.version, 1);
  assert.ok(payload.chunks.length > 1, 'The active map must use independently loadable chunks.');
  assert.deepEqual(
    payload.occluders.map((occluder) => occluder.id).sort(),
    INTERIORS.map((interior) => interior.id).sort()
  );
  for (const interior of INTERIORS) {
    const occluder = payload.occluders.find((candidate) => candidate.id === interior.id);
    assert.ok(occluder, `Missing exported roof group: ${interior.id}`);
    assert.equal(
      occluder.triangleCount,
      interior.roofTriangleCount,
      `Roof triangle contract changed for ${interior.id}.`
    );
    assert.ok(Math.abs(occluder.exteriorDoor.x * payload.blockSize - interior.exteriorDoor.x) <= 1);
    assert.ok(Math.abs(occluder.exteriorDoor.y * payload.blockSize - interior.exteriorDoor.y) <= 1);
    assert.ok(Math.abs(occluder.floorZ * payload.blockSize - interior.floorZ) <= 1);
  }
});
