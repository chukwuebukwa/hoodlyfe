import assert from 'node:assert/strict';
import test from 'node:test';
import {
  interpolatePosition,
  rotateTowards
} from '../src/game/rendering/interpolation-policy.ts';
import {projectileStyle} from '../src/game/rendering/projectile-render-policy.ts';
import {
  passengerPresentation,
  weaponPresentation
} from '../src/game/rendering/player-render-policy.ts';
import {vehicleVisualState} from '../src/game/rendering/vehicle-render-policy.ts';
import {pedestrianMotionPresentation} from '../src/game/rendering/pedestrian-render-policy.ts';
import type {NetworkBullet, NetworkVehicle} from '../src/game/types.ts';

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

test('player weapon models and passenger seats preserve stable presentation anchors', () => {
  assert.deepEqual(weaponPresentation('pistol'), {
    texture: 'weapon-pistol', width: 25, height: 9
  });
  assert.deepEqual(weaponPresentation('smg'), {
    texture: 'weapon-smg', width: 33, height: 11
  });
  assert.deepEqual(weaponPresentation('shotgun'), {
    texture: 'weapon-shotgun', width: 42, height: 10
  });
  const vehicle = {x: 100, y: 200, angle: 0};
  const frontRight = passengerPresentation(vehicle, 1, 0, 0, false);
  const rearLeft = passengerPresentation(vehicle, 2, 0, 0, false);
  const rear = passengerPresentation(vehicle, 3, 0, 0, false);
  assert.deepEqual({x: frontRight.baseX, y: frontRight.baseY}, {x: 105, y: 215});
  assert.deepEqual({x: rearLeft.baseX, y: rearLeft.baseY}, {x: 105, y: 185});
  assert.deepEqual({x: rear.baseX, y: rear.baseY}, {x: 89, y: 200});
  const recoil = passengerPresentation(vehicle, 1, 0, 0, true);
  assert.equal(recoil.spriteX, frontRight.spriteX - 4);
  assert.equal(recoil.scale, 0.64);
});

test('vehicle presentation stages model, component damage, fire, and destruction', () => {
  assert.deepEqual(vehicleVisualState(createVehicle()), {
    frame: 0, stage: 'healthy', smoke: false, fire: false, alpha: 1
  });
  assert.equal(vehicleVisualState(createVehicle({kind: 'police'})).frame, 1);
  assert.equal(vehicleVisualState(createVehicle({kind: 'taxi'})).frame, 2);
  assert.equal(vehicleVisualState(createVehicle({health: 300})).stage, 'damaged');
  assert.equal(vehicleVisualState(createVehicle({engineDamage: 100})).stage, 'smoking');
  assert.equal(vehicleVisualState(createVehicle({onFire: true})).stage, 'burning');
  assert.deepEqual(vehicleVisualState(createVehicle({destroyed: true})), {
    frame: 0,
    stage: 'wrecked',
    smoke: true,
    fire: true,
    alpha: 0.68,
    tint: 0x4f4f4f
  });
});

test('pedestrian presentation differentiates startle, flee, investigation, and recovery', () => {
  assert.deepEqual(pedestrianMotionPresentation('startle', 0), {
    animate: false, timeScale: 1, tint: 0xffd6a0, alpha: 1
  });
  assert.equal(pedestrianMotionPresentation('flee', 2).timeScale, 1.55);
  assert.equal(pedestrianMotionPresentation('investigate', 2).timeScale, 0.82);
  assert.equal(pedestrianMotionPresentation('recover', 0).animate, false);
  assert.equal(pedestrianMotionPresentation('dead', 0).alpha, 0);
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

function createVehicle(overrides: Partial<NetworkVehicle> = {}): NetworkVehicle {
  return {
    id: 'vehicle',
    kind: 'sedan',
    x: 0,
    y: 0,
    angle: 0,
    speed: 0,
    health: 1000,
    maxHealth: 1000,
    engineDamage: 0,
    damageFront: 0,
    damageRear: 0,
    damageLeft: 0,
    damageRight: 0,
    onFire: false,
    fireStartedAt: 0,
    destroyed: false,
    respawnAt: 0,
    driverId: '',
    traffic: false,
    hijackBy: '',
    ...overrides
  };
}
