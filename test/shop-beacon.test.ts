import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {createShopBeacon} from '../src/game/presentation/effects/shop-beacon.ts';

test('shop beacon combines an additive ray, soft ground projection, and strong colored cast', () => {
  const beacon = createShopBeacon({color: 0x20dcff, intensity: 1.08});
  const ray = beacon.getObjectByName('shop-beacon-ray');
  const ground = beacon.getObjectByName('shop-beacon-ground');
  const light = beacon.getObjectByName('shop-beacon-light');

  assert.ok(ray instanceof THREE.Mesh);
  assert.ok(ray.geometry instanceof THREE.ConeGeometry);
  assert.ok(ray.material instanceof THREE.ShaderMaterial);
  assert.equal(ray.material.blending, THREE.AdditiveBlending);
  assert.equal(ray.material.depthWrite, false);
  assert.match(ray.material.fragmentShader, /heightFade/);

  assert.ok(ground instanceof THREE.Mesh);
  assert.ok(ground.material instanceof THREE.ShaderMaterial);
  assert.match(ground.material.fragmentShader, /beamWidth/);
  assert.match(ground.material.fragmentShader, /pool/);

  assert.ok(light instanceof THREE.PointLight);
  assert.equal(light.color.getHex(), 0x20dcff);
  assert.ok(light.intensity > 4);

  assert.equal(beacon.getObjectByName('shop-beacon-pole'), undefined);
  assert.equal(beacon.getObjectByName('shop-beacon-housing'), undefined);
});
