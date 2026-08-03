import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {
  atlasUv,
  faceBrightness,
  mapSurfaceHeightAt,
  perspectiveHeightForSpan,
  renderedSurfaceHeight,
  serverAngleToScene,
  serverPedestrianAngleToScene,
  serverVehicleAngleToScene,
  serverYToScene,
  scenePointToServerAimAngle,
  renderedVehicleLampAnchor,
  vehicleLampAnchor,
  weaponDepthOffset,
  weaponSpriteVerticalScale
} from '../src/game/presentation/scene-policy.ts';
import type {WorldGeometryManifest} from '../src/game/presentation/map/geometry-format.ts';

test('scene policy maps tile-local UVs into the complete GTA2 atlas', () => {
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
  const eastSpriteRotation = serverVehicleAngleToScene(0);
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

test('scene policy converts the authoritative Y-down coordinate boundary exactly once', () => {
  assert.equal(serverYToScene(240), -240);
  assert.equal(serverAngleToScene(Math.PI / 3), -Math.PI / 3);
  assert.equal(serverPedestrianAngleToScene(0), Math.PI / 2);
  assert.equal(serverVehicleAngleToScene(0), -Math.PI / 2);
  assert.equal(scenePointToServerAimAngle(100, 200, 200, -200), 0);
  assert.equal(scenePointToServerAimAngle(100, 200, 100, -100), -Math.PI / 2);
});

test('left-facing weapon sprites flip locally without turning upside down', () => {
  assert.equal(weaponSpriteVerticalScale(0), 1);
  assert.equal(weaponSpriteVerticalScale(Math.PI / 4), 1);
  assert.equal(weaponSpriteVerticalScale(-Math.PI / 4), 1);
  assert.equal(weaponSpriteVerticalScale(Math.PI), -1);
  assert.equal(weaponSpriteVerticalScale(Math.PI * 0.75), -1);
  assert.equal(weaponSpriteVerticalScale(-Math.PI * 0.75), -1);
});

test('north-facing weapons render behind an on-foot player without changing passenger depth', () => {
  assert.equal(weaponDepthOffset(-Math.PI / 2, false), -1);
  assert.equal(weaponDepthOffset(-Math.PI / 4, false), -1);
  assert.equal(weaponDepthOffset(0, false), 2);
  assert.equal(weaponDepthOffset(Math.PI / 2, false), 2);
  assert.equal(weaponDepthOffset(-Math.PI / 2, true), 2);
});

test('scene policy derives perspective height and production face shading deterministically', () => {
  assert.ok(Math.abs(perspectiveHeightForSpan(512) - 618.0386719675123) < 0.001);
  assert.equal(faceBrightness(0), 1);
  assert.equal(faceBrightness(1), 16 / 31);
  assert.equal(faceBrightness(20), 0.18);
});

test('authored surfaces override the topmost map height for every elevation', () => {
  const map = JSON.parse(
    readFileSync('public/assets/maps/geometry/world.json', 'utf8')
  ) as WorldGeometryManifest;

  const spawnHeight = mapSurfaceHeightAt(8416, 8288, map);
  assert.equal(spawnHeight, 128);
  assert.equal(renderedSurfaceHeight('street-ground', 0, spawnHeight, 'street-ground'), 0);
  assert.equal(renderedSurfaceHeight('bridge-ramp', 256, spawnHeight, 'street-ground'), 256);
  assert.equal(renderedSurfaceHeight(undefined, undefined, spawnHeight, 'street-ground'), 128);
});
