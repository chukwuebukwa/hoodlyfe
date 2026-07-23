import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import type {ProjectileImpactPayload} from '../shared/protocol/projectile-impacts.ts';
import {ProjectileImpactEffects} from '../src/game/presentation/effects/projectile-impacts.ts';

test('projectile impact sparks reuse one point buffer, dedupe, and expire', () => {
  const scene = new THREE.Scene();
  const effects = new ProjectileImpactEffects(scene, () => 4);
  const impact: ProjectileImpactPayload = {
    id: '1:0:bullet',
    tick: 1,
    weapon: 'pistol',
    targetKind: 'world',
    x: 10,
    y: 20,
    angle: 0,
    surfaceId: 'street-ground'
  };

  effects.present([impact], 0);
  effects.present([impact], 80);
  effects.update(80);
  const points = scene.children[0] as THREE.Points<THREE.BufferGeometry>;
  assert.equal([...points.geometry.attributes.color.array].filter((value) => value > 0).length, 9);

  effects.update(150);
  assert.equal([...points.geometry.attributes.color.array].some((value) => value > 0), false);
  effects.destroy();
  assert.equal(scene.children.length, 0);
});
