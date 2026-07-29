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

test('actor projectile impacts spray blood and leave one fading ground splatter', () => {
  const scene = new THREE.Scene();
  const bloodTexture = new THREE.Texture();
  const effects = new ProjectileImpactEffects(scene, () => 4, bloodTexture);
  const impact: ProjectileImpactPayload = {
    id: '2:0:bullet',
    tick: 2,
    weapon: 'shotgun',
    targetKind: 'npc',
    targetId: 'pedestrian-1',
    x: 10,
    y: 20,
    angle: 0,
    surfaceId: 'street-ground'
  };

  effects.present([impact], 0);
  effects.present([impact], 40);
  effects.update(100);

  const points = scene.getObjectByName('projectile-impact-particles') as THREE.Points<THREE.BufferGeometry>;
  const colors = points.geometry.attributes.color.array;
  let maximumRed = 0;
  let maximumGreen = 0;
  for (let index = 0; index < colors.length; index += 3) {
    maximumRed = Math.max(maximumRed, colors[index]);
    maximumGreen = Math.max(maximumGreen, colors[index + 1]);
  }
  assert.ok(maximumRed > 0.3);
  assert.ok(maximumRed > maximumGreen * 10);

  const splatters = scene.children.filter((child) => child.name === 'projectile-blood-splatter');
  assert.equal(splatters.length, 1);
  assert.equal(splatters[0].position.z, 5.5);

  effects.update(18_001);
  assert.equal(scene.getObjectByName('projectile-blood-splatter'), undefined);
  effects.destroy();
  bloodTexture.dispose();
  assert.equal(scene.children.length, 0);
});
