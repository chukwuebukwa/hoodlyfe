import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {
  createShopBeacon,
  REPAIR_ALLEY_BEACON_PLACEMENT,
  REPAIR_SHOP_BEACON_PLACEMENT
} from '../src/game/presentation/effects/shop-beacon.ts';

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
  assert.ok(volume.geometry instanceof THREE.BufferGeometry);
  assert.equal(volume.geometry instanceof THREE.ConeGeometry, false);
  assert.ok(volume.material instanceof THREE.ShaderMaterial);
  assert.equal(volume.material.depthTest, false);
  assert.match(volume.material.fragmentShader, /startFade/);
  assert.match(volume.material.fragmentShader, /endFade/);
  assert.doesNotMatch(volume.material.vertexShader, /beaconViewDirection/);
  assert.doesNotMatch(volume.material.fragmentShader, /silhouette/);
  assert.equal(beacon.getObjectByName('shop-beacon-volume-blade'), undefined);

  const volumePositions = volume.geometry.getAttribute('position');
  assert.equal(volumePositions.count, 48 * 3);
  const baseHeights = new Set<number>();
  for (let index = 0; index < volumePositions.count; index++) {
    if (index % 3 !== 0) baseHeights.add(volumePositions.getZ(index));
  }
  assert.deepEqual([...baseHeights], [-50.5]);

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

test('shop beacon derives every rendered position from one placement object', () => {
  const placement = {
    ...REPAIR_SHOP_BEACON_PLACEMENT,
    position: [20, 30, 140] as const,
    aimOffset: [50, -90, -100] as const
  };
  const beacon = createShopBeacon({color: 0x20dcff, placement});
  const ray = beacon.getObjectByName('shop-beacon-ray');
  const volume = beacon.getObjectByName('shop-beacon-volume');
  const bloom = beacon.getObjectByName('shop-beacon-bloom');
  const light = beacon.getObjectByName('shop-beacon-light');

  assert.ok(ray instanceof THREE.Mesh);
  assert.deepEqual(ray.position.toArray(), [70, -60, -5.5]);

  assert.ok(volume instanceof THREE.Mesh);
  assert.deepEqual(volume.position.toArray(), [45, -15, 90]);

  assert.ok(bloom instanceof THREE.Mesh);
  assert.deepEqual(bloom.position.toArray(), [20, 30, 140]);

  assert.ok(light instanceof THREE.PointLight);
  assert.deepEqual(light.position.toArray(), [20, -16, 78]);
});

test('repair alley beacon mounts inside the passage and aims back through it', () => {
  const beacon = createShopBeacon({
    color: 0x20dcff,
    intensity: 0.82,
    placement: REPAIR_ALLEY_BEACON_PLACEMENT
  });
  const ray = beacon.getObjectByName('shop-beacon-ray');
  const bloom = beacon.getObjectByName('shop-beacon-bloom');
  const light = beacon.getObjectByName('shop-beacon-light');

  assert.ok(ray instanceof THREE.Mesh);
  assert.deepEqual(ray.position.toArray(), [146, 184, -5.5]);

  assert.ok(bloom instanceof THREE.Mesh);
  assert.deepEqual(bloom.position.toArray(), [216, 280, 108]);

  assert.ok(light instanceof THREE.PointLight);
  assert.equal(light.color.getHex(), 0x20dcff);
  assert.deepEqual(light.position.toArray(), [216, 234, 46]);
});
