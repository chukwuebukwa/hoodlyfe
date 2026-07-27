import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {
  updateVehicleTaillights,
  vehicleTaillights
} from '../src/game/presentation/effects/vehicle-taillights.ts';

test('vehicle taillights use attached twin sources with a short rear road spill', () => {
  const taillights = vehicleTaillights(60, 30);
  taillights.geometry.computeBoundingBox();
  const bounds = taillights.geometry.boundingBox;
  assert.ok(bounds);
  assert.ok(Math.abs(bounds.min.x + 22.8) < 0.001);
  assert.ok(Math.abs(bounds.max.x - 4) < 0.001);
  assert.equal(taillights.material.blending, THREE.AdditiveBlending);
  assert.equal(taillights.material.depthWrite, false);
  assert.equal(taillights.material.toneMapped, false);
  assert.match(taillights.material.fragmentShader, /lampSource/);
  assert.match(taillights.material.fragmentShader, /roadSpill/);

  updateVehicleTaillights(taillights, 0xf4f0d8, 0.4);
  assert.equal(taillights.material.uniforms.lampColor.value.getHex(), 0xf4f0d8);
  assert.equal(taillights.material.uniforms.lampOpacity.value, 0.4);
});
