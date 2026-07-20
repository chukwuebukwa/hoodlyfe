import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import * as THREE from 'three';
import {FBXLoader} from 'three/addons/loaders/FBXLoader.js';
import {vehicleDefinition} from '../shared/content/vehicle-catalog.ts';
import {
  normalizeVehicleModel,
  ThreeVehicleModelLoader
} from '../src/game/three/three-vehicle-model-loader.ts';

test('sedan FBX normalizes to the authoritative footprint and forward axis', () => {
  const bytes = readFileSync('public/assets/vehicles/3d/sedan.fbx');
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const source = new FBXLoader().parse(buffer, '');
  const model = normalizeVehicleModel(source, vehicleDefinition('sedan').collision);
  model.updateMatrixWorld(true);

  const bounds = new THREE.Box3().setFromObject(model);
  const size = bounds.getSize(new THREE.Vector3());
  assert.ok(Math.abs(size.x - vehicleDefinition('sedan').collision.length) < 0.01);
  assert.ok(size.y <= vehicleDefinition('sedan').collision.width + 0.01);
  assert.ok(size.y >= vehicleDefinition('sedan').collision.width * 0.95);
  assert.ok(Math.abs(bounds.min.z) < 0.01);
  assert.ok(size.z > 18 && size.z < 24);

  const front = model.getObjectByName('Sedan_wheel_front_left');
  const rear = model.getObjectByName('Sedan_wheel_rear_left');
  assert.ok(front && rear);
  assert.ok(
    front.getWorldPosition(new THREE.Vector3()).x > rear.getWorldPosition(new THREE.Vector3()).x,
    'The model nose must face local +X before applying authoritative heading.'
  );

  const baseHeight = size.z;
  for (const heading of [0.3, 0.7, 1.2, Math.PI / 2, 2]) {
    model.rotation.z = heading;
    model.updateMatrixWorld(true);
    const rotatedBounds = new THREE.Box3().setFromObject(model);
    const rotatedSize = rotatedBounds.getSize(new THREE.Vector3());
    assert.ok(Math.abs(rotatedBounds.min.z) < 0.01, `heading ${heading} must stay grounded`);
    assert.ok(
      Math.abs(rotatedSize.z - baseHeight) < 0.01,
      `heading ${heading} must not tip the model onto its side`
    );
  }
});

test('the model loader opts in only the first sedan prototype', () => {
  const loader = new ThreeVehicleModelLoader();
  assert.equal(loader.hasModel('sedan'), true);
  assert.equal(loader.hasModel('r33'), false);
  assert.equal(loader.hasModel('s15'), false);
  loader.destroy();
});
