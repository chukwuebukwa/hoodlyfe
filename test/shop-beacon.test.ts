import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {createShopBeacon} from '../src/game/presentation/effects/shop-beacon.ts';

test('shop beacon combines a soft projected ray and strong colored cast', () => {
  const beacon = createShopBeacon({color: 0x20dcff, intensity: 1.08});
  const ray = beacon.getObjectByName('shop-beacon-ray');
  const volume = beacon.getObjectByName('shop-beacon-volume');
  const light = beacon.getObjectByName('shop-beacon-light');
  const bloom = beacon.getObjectByName('shop-beacon-bloom');

  assert.ok(ray instanceof THREE.Mesh);
  assert.equal(beacon.userData.disableMarkerPulse, true);
  assert.ok(ray.geometry instanceof THREE.PlaneGeometry);
  assert.ok(ray.material instanceof THREE.ShaderMaterial);
  assert.equal(ray.material.blending, THREE.AdditiveBlending);
  assert.equal(ray.material.depthWrite, false);
  assert.match(ray.material.fragmentShader, /edgeSoftness/);
  assert.match(ray.material.fragmentShader, /ellipse/);
  assert.match(ray.material.fragmentShader, /pool/);
  assert.equal(beacon.getObjectByName('shop-beacon-ground'), undefined);

  assert.ok(volume instanceof THREE.Mesh);
  assert.ok(volume.geometry instanceof THREE.ConeGeometry);
  assert.ok(volume.material instanceof THREE.ShaderMaterial);
  assert.match(volume.material.fragmentShader, /silhouette/);
  assert.match(volume.material.fragmentShader, /edgeFade/);
  assert.equal(beacon.getObjectByName('shop-beacon-volume-blade'), undefined);

  assert.ok(light instanceof THREE.PointLight);
  assert.equal(light.color.getHex(), 0x20dcff);
  assert.ok(light.intensity > 4);

  assert.ok(bloom instanceof THREE.Mesh);
  assert.ok(bloom.position.y > light.position.y);
  assert.ok(light.position.y > ray.position.y);
  assert.ok(bloom.position.z > ray.position.z);

  assert.equal(beacon.getObjectByName('shop-beacon-pole'), undefined);
  assert.equal(beacon.getObjectByName('shop-beacon-housing'), undefined);
});
