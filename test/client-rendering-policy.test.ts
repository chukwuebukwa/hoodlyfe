import assert from 'node:assert/strict';
import test from 'node:test';
import {
  interpolatePosition,
  rotateTowards
} from '../src/game/rendering/interpolation-policy.ts';
import {projectileStyle} from '../src/game/rendering/projectile-render-policy.ts';
import type {NetworkBullet} from '../src/game/types.ts';

test('render interpolation blends ordinary correction and snaps large divergence', () => {
  assert.deepEqual(interpolatePosition(0, 0, 100, 50, 0.2, 200), {
    x: 20,
    y: 10,
    distance: Math.hypot(100, 50),
    snapped: false
  });
  assert.deepEqual(interpolatePosition(0, 0, 300, 0, 0.2, 120), {
    x: 300,
    y: 0,
    distance: 300,
    snapped: true
  });
  assert.equal(interpolatePosition(0, 0, 10, 0, 4).x, 10);
  assert.equal(interpolatePosition(0, 0, 10, 0, -1).x, 0);
});

test('render rotation follows the shortest wrapped angle', () => {
  const degrees = (value: number) => value * Math.PI / 180;
  const acrossWrap = rotateTowards(degrees(179), degrees(-179), degrees(1));
  assert.ok(Math.abs(Math.abs(acrossWrap) - Math.PI) < 0.0001);
  assert.ok(Math.abs(rotateTowards(0, 0.05, 0.2) - 0.05) < 0.0001);
  assert.equal(rotateTowards(0, 1, -2), 0);
});

test('projectile presentation preserves weapon style and police override', () => {
  assert.deepEqual(projectileStyle(createBullet('pistol')), {color: 0xffdc55, radius: 3.2});
  assert.deepEqual(projectileStyle(createBullet('smg')), {color: 0xff9f43, radius: 2.5});
  assert.deepEqual(projectileStyle(createBullet('shotgun')), {color: 0xffe8a3, radius: 3.5});
  assert.deepEqual(projectileStyle({...createBullet('shotgun'), ownerKind: 'police'}), {
    color: 0xff6262,
    radius: 3.5
  });
});

function createBullet(weapon: NetworkBullet['weapon']): NetworkBullet {
  return {
    id: 'bullet',
    ownerId: 'driver',
    ownerKind: 'player',
    x: 0,
    y: 0,
    angle: 0,
    createdAt: 0,
    weapon
  };
}
