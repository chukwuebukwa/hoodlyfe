import assert from 'node:assert/strict';
import test from 'node:test';
import {
  atlasUv,
  faceBrightness,
  perspectiveHeightForSpan,
  serverAngleToThree,
  serverPedestrianAngleToThree,
  serverVehicleAngleToThree,
  serverYToThree,
  threePointToServerAimAngle
} from '../src/game/three/three-prototype-policy.ts';

test('three prototype maps tile-local UVs into the complete GTA2 atlas', () => {
  assert.deepEqual(atlasUv({tile: 33, u: 0.25, v: 0.75}, {columns: 32, rows: 31}), [
    1.25 / 32,
    1.75 / 31
  ]);
});

test('three prototype converts the authoritative Y-down coordinate boundary exactly once', () => {
  assert.equal(serverYToThree(240), -240);
  assert.equal(serverAngleToThree(Math.PI / 3), -Math.PI / 3);
  assert.equal(serverPedestrianAngleToThree(0), Math.PI / 2);
  assert.equal(serverVehicleAngleToThree(0), -Math.PI / 2);
  assert.equal(threePointToServerAimAngle(100, 200, 200, -200), 0);
  assert.equal(threePointToServerAimAngle(100, 200, 100, -100), -Math.PI / 2);
});

test('three prototype derives perspective height and production face shading deterministically', () => {
  assert.ok(Math.abs(perspectiveHeightForSpan(512) - 618.0386719675123) < 0.001);
  assert.equal(faceBrightness(0), 1);
  assert.equal(faceBrightness(1), 16 / 31);
  assert.equal(faceBrightness(20), 0.18);
});
