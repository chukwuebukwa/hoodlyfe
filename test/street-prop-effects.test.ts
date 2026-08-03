import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {StreetPropEffects} from '../src/game/presentation/effects/street-prop-effects.ts';
import type {NetworkStreetProp} from '../src/game/types.ts';

test('destroyed props present persistent water and one deterministic debris burst', () => {
  const scene = new THREE.Scene();
  const effects = new StreetPropEffects(
    scene,
    () => 4,
    new THREE.Texture(),
    new THREE.Texture()
  );
  const hydrant = prop('hydrant', 'hydrant.red-brass');
  const trash = prop('trash', 'trash-can.galvanized');

  effects.synchronize(new Map([[hydrant.id, hydrant], [trash.id, trash]]), 0);
  assert.equal(named(scene, 'street-prop-water-spray').length, 0);
  assert.equal(named(scene, 'street-prop-trash-debris').length, 0);

  hydrant.destroyed = true;
  hydrant.damageStage = 2;
  hydrant.hitSequence = 1;
  trash.destroyed = true;
  trash.damageStage = 2;
  trash.hitSequence = 1;
  effects.synchronize(new Map([[hydrant.id, hydrant], [trash.id, trash]]), 100);
  assert.equal(named(scene, 'street-prop-water-spray').length, 2);
  assert.equal(named(scene, 'street-prop-trash-debris').length, 9);

  effects.synchronize(new Map([[hydrant.id, hydrant], [trash.id, trash]]), 200);
  assert.equal(named(scene, 'street-prop-trash-debris').length, 9);

  hydrant.destroyed = false;
  effects.synchronize(new Map([[hydrant.id, hydrant], [trash.id, trash]]), 300);
  assert.equal(named(scene, 'street-prop-water-spray').length, 0);

  effects.clear();
  assert.equal(named(scene, 'street-prop-trash-debris').length, 0);
  effects.destroy();
});

function prop(id: string, definitionId: string): NetworkStreetProp {
  return {
    id,
    definitionId,
    surfaceId: 'street-ground',
    x: 10,
    y: 20,
    angle: 0,
    health: 30,
    maxHealth: 30,
    damageStage: 0,
    hitSequence: 0,
    hitAngle: 0,
    destroyed: false,
    resetAt: 0
  };
}

function named(scene: THREE.Scene, name: string): THREE.Object3D[] {
  const found: THREE.Object3D[] = [];
  scene.traverse((object) => {
    if (object.name === name) found.push(object);
  });
  return found;
}
