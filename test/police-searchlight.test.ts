import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {
  createPoliceSearchlight,
  disposePoliceSearchlight,
  policeSearchlightDetailForDistance,
  updatePoliceSearchlight
} from '../src/game/presentation/effects/police-searchlight.ts';

test('police searchlight aligns its cone from the helicopter to the ground target', () => {
  const searchlight = createPoliceSearchlight();
  assert.equal(searchlight.volume.geometry.parameters.radialSegments, 16);
  assert.equal(searchlight.volume.material.side, THREE.FrontSide);
  const source = new THREE.Vector3(90, -20, 180);
  const target = new THREE.Vector3(250, 130, 3);
  const radius = 76;
  updatePoliceSearchlight(searchlight, {source, target, radius, intensity: 1});

  assert.equal(searchlight.group.visible, true);
  assert.ok(searchlight.footprint.position.distanceTo(target) < 0.001);
  assert.deepEqual(searchlight.footprint.scale.toArray(), [radius, radius * 0.78, 1]);

  const expectedMidpoint = source.clone().add(target).multiplyScalar(0.5);
  assert.ok(searchlight.volume.position.distanceTo(expectedMidpoint) < 0.001);
  assert.ok(Math.abs(searchlight.volume.scale.y - source.distanceTo(target)) < 0.001);

  const coneAxis = new THREE.Vector3(0, 1, 0)
    .applyQuaternion(searchlight.volume.quaternion)
    .normalize();
  const expectedAxis = source.clone().sub(target).normalize();
  assert.ok(coneAxis.distanceTo(expectedAxis) < 0.001);
  assert.ok(searchlight.sourceGlow.position.distanceTo(source) < 0.001);

  disposePoliceSearchlight(searchlight);
});

test('police searchlight hides when its authoritative intensity is zero', () => {
  const searchlight = createPoliceSearchlight();
  updatePoliceSearchlight(searchlight, {
    source: new THREE.Vector3(0, 0, 100),
    target: new THREE.Vector3(0, 0, 0),
    radius: 50,
    intensity: 0
  });
  assert.equal(searchlight.group.visible, false);
  disposePoliceSearchlight(searchlight);
});

test('police searchlight detail drops volume before hiding the full effect', () => {
  assert.equal(policeSearchlightDetailForDistance(850), 'full');
  assert.equal(policeSearchlightDetailForDistance(851), 'footprint');
  assert.equal(policeSearchlightDetailForDistance(1_500), 'footprint');
  assert.equal(policeSearchlightDetailForDistance(1_501), 'hidden');

  const searchlight = createPoliceSearchlight();
  updatePoliceSearchlight(searchlight, {
    source: new THREE.Vector3(0, 0, 100),
    target: new THREE.Vector3(0, 0, 0),
    radius: 50,
    intensity: 1,
    detail: 'footprint'
  });
  assert.equal(searchlight.group.visible, true);
  assert.equal(searchlight.footprint.visible, true);
  assert.equal(searchlight.volume.visible, false);
  assert.equal(searchlight.sourceGlow.visible, false);

  updatePoliceSearchlight(searchlight, {
    source: new THREE.Vector3(0, 0, 100),
    target: new THREE.Vector3(0, 0, 0),
    radius: 50,
    intensity: 1,
    detail: 'hidden'
  });
  assert.equal(searchlight.group.visible, false);
  disposePoliceSearchlight(searchlight);
});
