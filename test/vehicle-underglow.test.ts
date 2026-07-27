import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {
  updateVehicleUnderglow,
  vehicleUnderglow,
  vehicleUnderglowRotation
} from '../src/game/presentation/effects/vehicle-underglow.ts';

test('vehicle underglow removes the sprite atlas quarter-turn', () => {
  assert.equal(vehicleUnderglowRotation(0.25), 0.25 + Math.PI / 2);
});

test('vehicle underglow uses an oversized road projection with defined rails and broad spill', () => {
  const glow = vehicleUnderglow(60, 30);
  const bounds = glow.geometry.boundingBox ?? (() => {
    glow.geometry.computeBoundingBox();
    return glow.geometry.boundingBox;
  })();
  assert.ok(bounds);
  assert.ok(Math.abs(bounds.max.x - bounds.min.x - 99) < 0.001);
  assert.ok(Math.abs(bounds.max.y - bounds.min.y - 91.5) < 0.001);
  assert.equal(glow.material.blending, THREE.AdditiveBlending);
  assert.equal(glow.material.depthWrite, false);
  assert.equal(glow.material.toneMapped, false);
  assert.match(glow.material.fragmentShader, /roadHalo = exp/);
  assert.match(glow.material.fragmentShader, /capsuleDistance/);
  assert.match(glow.material.fragmentShader, /railCore/);
  assert.match(glow.material.fragmentShader, /railBloom/);
  assert.match(glow.material.fragmentShader, /boundaryFade/);

  updateVehicleUnderglow(glow, 0xff3ec8, 0.58);
  assert.equal(glow.material.uniforms.glowColor.value.getHex(), 0xff3ec8);
  assert.equal(glow.material.uniforms.glowOpacity.value, 0.58);
});
