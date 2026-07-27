import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {
  updateVehicleHeadlights,
  vehicleHeadlights
} from '../src/game/presentation/effects/vehicle-headlights.ts';

test('vehicle headlights project forward from attached twin lamp sources', () => {
  const headlights = vehicleHeadlights(60, 30);
  headlights.geometry.computeBoundingBox();
  const bounds = headlights.geometry.boundingBox;
  assert.ok(bounds);
  assert.ok(Math.abs(bounds.min.x + 5) < 0.001);
  assert.ok(Math.abs(bounds.max.x - 76.8) < 0.001);
  assert.equal(headlights.material.blending, THREE.AdditiveBlending);
  assert.equal(headlights.material.depthWrite, false);
  assert.equal(headlights.material.toneMapped, false);
  assert.match(headlights.material.fragmentShader, /lampSource/);
  assert.match(headlights.material.fragmentShader, /forwardGate/);

  updateVehicleHeadlights(headlights, 0xffe8ad, 0.42);
  assert.equal(headlights.material.uniforms.beamColor.value.getHex(), 0xffe8ad);
  assert.equal(headlights.material.uniforms.beamOpacity.value, 0.42);
});
