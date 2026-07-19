import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {
  atlasUv,
  faceBrightness,
  mapSurfaceHeightAt,
  perspectiveHeightForSpan,
  renderedSurfaceHeight,
  serverAngleToThree,
  serverPedestrianAngleToThree,
  serverVehicleAngleToThree,
  serverYToThree,
  threePointToServerAimAngle,
  renderedVehicleLampAnchor,
  vehicleLampAnchor
} from '../src/game/three/three-prototype-policy.ts';
import type {ThreeMapManifest} from '../src/game/three/three-map-format.ts';

test('three prototype maps tile-local UVs into the complete GTA2 atlas', () => {
  assert.deepEqual(atlasUv({tile: 33, u: 0.25, v: 0.75}, {columns: 32, rows: 31}), [
    1.25 / 32,
    1.75 / 31
  ]);
});

test('vehicle lamp anchors follow physical heading without the sprite atlas quarter-turn', () => {
  const east = vehicleLampAnchor(100, 200, 0, 40);
  assert.equal(east.x, 140);
  assert.equal(east.y, -200);
  assert.ok(Math.abs(east.rotation) < 0.0001);
  const south = vehicleLampAnchor(100, 200, Math.PI / 2, 40);
  assert.ok(Math.abs(south.x - 100) < 0.0001);
  assert.ok(Math.abs(south.y + 240) < 0.0001);
  const west = vehicleLampAnchor(100, 200, Math.PI, 40);
  assert.ok(Math.abs(west.x - 60) < 0.0001);
  assert.ok(Math.abs(west.y + 200) < 0.0001);
  const north = vehicleLampAnchor(100, 200, -Math.PI / 2, 40);
  assert.ok(Math.abs(north.x - 100) < 0.0001);
  assert.ok(Math.abs(north.y + 160) < 0.0001);
});

test('rendered lamp anchors stay attached to the interpolated vehicle sprite heading', () => {
  const eastSpriteRotation = serverVehicleAngleToThree(0);
  assert.deepEqual(
    renderedVehicleLampAnchor(100, -200, eastSpriteRotation, 40),
    {x: 140, y: -200, rotation: 0}
  );
  const turningSpriteRotation = -Math.PI / 4;
  const anchor = renderedVehicleLampAnchor(100, -200, turningSpriteRotation, 40);
  assert.ok(Math.abs(anchor.x - (100 + Math.SQRT1_2 * 40)) < 0.0001);
  assert.ok(Math.abs(anchor.y - (-200 + Math.SQRT1_2 * 40)) < 0.0001);
  assert.ok(Math.abs(anchor.rotation - Math.PI / 4) < 0.0001);
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

test('expanded district actors use the rendered street height at spawn', () => {
  const map = JSON.parse(
    readFileSync('public/assets/maps/three/world.json', 'utf8')
  ) as ThreeMapManifest;

  const spawnHeight = mapSurfaceHeightAt(8416, 8288, map);
  assert.equal(spawnHeight, 128);
  assert.equal(renderedSurfaceHeight('street-ground', 0, spawnHeight, 'street-ground'), 128);
  assert.equal(renderedSurfaceHeight('bridge-ramp', 256, spawnHeight, 'street-ground'), 256);
});
