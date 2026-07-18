import assert from 'node:assert/strict';
import test from 'node:test';
import {
  interpolatePosition,
  rotateTowards
} from '../src/game/rendering/interpolation-policy.ts';
import {projectileStyle} from '../src/game/rendering/projectile-render-policy.ts';
import {
  meleeAttackPresentation,
  meleeAttackPresentationAtProgress,
  passengerPresentation,
  playerAttachmentPresentation,
  weaponPresentation
} from '../src/game/rendering/player-render-policy.ts';
import {vehicleVisualState} from '../src/game/rendering/vehicle-render-policy.ts';
import {pedestrianMotionPresentation} from '../src/game/rendering/pedestrian-render-policy.ts';
import {npcMeleePresentation} from '../src/game/rendering/npc-melee-render-policy.ts';
import {combatReactionPresentation} from '../src/game/rendering/combat-reaction-render-policy.ts';
import {thrownProjectilePresentation} from '../src/game/rendering/thrown-projectile-render-policy.ts';
import {explosionPresentation} from '../src/game/rendering/explosion-render-policy.ts';
import {weaponPickupMinimapPoints} from '../src/game/rendering/weapon-pickup-render-policy.ts';
import {actorBurnPresentation} from '../src/game/rendering/actor-burn-render-policy.ts';
import type {
  NetworkBullet,
  NetworkExplosion,
  NetworkThrownProjectile,
  NetworkVehicle,
  NetworkWeaponPickup
} from '../src/game/types.ts';

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
  assert.deepEqual(projectileStyle({...createBullet('smg'), ownerKind: 'hostile'}), {
    color: 0xff9d3f,
    radius: 2.5
  });
});

test('player weapon models and passenger seats preserve stable presentation anchors', () => {
  assert.deepEqual(weaponPresentation('pistol'), {
    texture: 'weapon-pistol', width: 25, height: 9, visible: true, originX: 0.16
  });
  assert.deepEqual(weaponPresentation('smg'), {
    texture: 'weapon-smg', width: 33, height: 11, visible: true, originX: 0.16
  });
  assert.deepEqual(weaponPresentation('shotgun'), {
    texture: 'weapon-shotgun', width: 42, height: 10, visible: true, originX: 0.16
  });
  assert.deepEqual(weaponPresentation('rocket'), {
    texture: 'weapon-rocket', width: 48, height: 14, visible: true, originX: 0.16
  });
  assert.deepEqual(weaponPresentation('grenade'), {
    texture: 'weapon-grenade', width: 15, height: 15, visible: true, originX: 0.16
  });
  assert.deepEqual(weaponPresentation('fists'), {
    texture: 'weapon-fists', width: 1, height: 1, visible: false, originX: 0.16
  });
  assert.deepEqual(weaponPresentation('bat'), {
    texture: 'weapon-bat', width: 46, height: 12, visible: true, originX: 0.16
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

test('one attachment root owns body, weapon, label, minimap, and collider presentation', () => {
  const actor = {x: 10, y: 20, angle: 0.25};
  const vehicle = {x: 100, y: 200, angle: 0.5};
  const onFoot = playerAttachmentPresentation(actor, undefined, -1, 0.25, 0, false);
  assert.deepEqual(onFoot.root, actor);
  assert.deepEqual(onFoot.body, actor);
  assert.deepEqual(onFoot.weaponBase, {x: 10, y: 20});
  assert.equal(onFoot.humanoidColliderVisible, true);

  const driver = playerAttachmentPresentation(actor, vehicle, 0, 1, 0, false);
  assert.deepEqual(driver.root, vehicle);
  assert.equal(driver.bodyVisible, false);
  assert.equal(driver.humanoidColliderVisible, false);

  const passenger = playerAttachmentPresentation(actor, vehicle, 1, 1, 0, true);
  assert.deepEqual(passenger.root, vehicle);
  assert.deepEqual(passenger.weaponBase, {
    x: passenger.passenger?.baseX,
    y: passenger.passenger?.baseY
  });
  assert.deepEqual(
    {x: passenger.body.x, y: passenger.body.y},
    {x: passenger.passenger?.spriteX, y: passenger.passenger?.spriteY}
  );
  assert.equal(passenger.humanoidColliderVisible, false);
});

test('melee attack presentation follows replicated combo and catalog strike timing', () => {
  const first = meleeAttackPresentation('fists', 0, 135);
  const repeated = meleeAttackPresentation('fists', 0, 135);
  const second = meleeAttackPresentation('fists', 1, 145);
  const batImpact = meleeAttackPresentation('bat', 0, 285);

  assert.deepEqual(first, repeated);
  assert.equal(first.active, true);
  assert.ok(first.bodyRotationOffset > 0);
  assert.ok(second.bodyRotationOffset < 0);
  assert.ok(batImpact.weaponDistance > 14);
  assert.ok(Math.abs(batImpact.weaponRotationOffset) > 1);
  assert.equal(meleeAttackPresentation('bat', 0, 610).active, false);
  assert.equal(meleeAttackPresentation('pistol', 0, 100).active, false);
  assert.deepEqual(
    meleeAttackPresentationAtProgress('bat', 0, 285 / 610),
    batImpact
  );
  assert.equal(meleeAttackPresentationAtProgress('bat', 0, 1).active, false);
});

test('combat reactions are deterministic, directional, and driven only by replicated progress', () => {
  const state = Object.freeze({
    reactionKind: 'stagger' as const,
    reactionDirection: 'left' as const,
    reactionProgress: 0.5
  });
  const first = combatReactionPresentation(state);
  assert.deepEqual(combatReactionPresentation(state), first);
  assert.equal(first.active, true);
  assert.equal(first.stopMovement, true);
  assert.ok(first.rotationOffset < 0);
  assert.ok(first.scaleX < 1);
  assert.equal(state.reactionProgress, 0.5);

  const right = combatReactionPresentation({...state, reactionDirection: 'right'});
  assert.ok(right.rotationOffset > 0);
  assert.equal(right.scaleX, first.scaleX);
  assert.equal(right.scaleY, first.scaleY);

  const neutral = combatReactionPresentation({
    reactionKind: '',
    reactionDirection: 'front',
    reactionProgress: 0.5
  });
  assert.deepEqual(neutral, {
    active: false,
    stopMovement: false,
    rotationOffset: 0,
    scaleX: 1,
    scaleY: 1
  });
});

test('knockdown settles into an obvious replicated end pose and suppresses walking', () => {
  const knockdown = combatReactionPresentation({
    reactionKind: 'knockdown',
    reactionDirection: 'back',
    reactionProgress: 1
  });
  assert.equal(knockdown.active, true);
  assert.ok(Math.abs(knockdown.rotationOffset) > 1.4);
  assert.ok(knockdown.scaleY < 0.6);
  assert.equal(knockdown.tint, 0xff6f61);
  assert.deepEqual(pedestrianMotionPresentation('flee', 12, knockdown.active), {
    animate: false,
    timeScale: 1,
    alpha: 1
  });
});

test('explosive and pickup presentation follows replicated height, fuse, kind, and availability', () => {
  const thrown: NetworkThrownProjectile = {
    id: 'grenade-1', ownerId: 'driver', kind: 'grenade',
    x: 10, y: 20, height: 60, angle: 0, createdAt: 0, fuseAt: 2000
  };
  const early = thrownProjectilePresentation(thrown, 200);
  const late = thrownProjectilePresentation(thrown, 1900);
  assert.equal(early.texture, 'weapon-grenade');
  assert.equal(early.modelY, -60);
  assert.ok(early.shadowScale < 1);
  assert.notEqual(late.modelScale, 0.58);

  const grenadeExplosion = explosionPresentation(explosion('grenade'));
  const rocketExplosion = explosionPresentation(explosion('rocket'));
  const vehicleExplosion = explosionPresentation(explosion('vehicle'));
  assert.ok(rocketExplosion.durationMs > grenadeExplosion.durationMs);
  assert.ok(rocketExplosion.shakeIntensity > grenadeExplosion.shakeIntensity);
  assert.ok(vehicleExplosion.durationMs > grenadeExplosion.durationMs);
  assert.ok(vehicleExplosion.shakeIntensity > grenadeExplosion.shakeIntensity);

  const available = pickup({id: 'available', available: true});
  const hidden = pickup({id: 'hidden', available: false});
  assert.deepEqual(weaponPickupMinimapPoints([hidden, available]), [{
    id: 'available', kind: 'pickup', x: 100, y: 120
  }]);
});

test('vehicle presentation stages model, component damage, fire, and destruction', () => {
  assert.deepEqual(vehicleVisualState(createVehicle()), {
    frame: 0, stage: 'healthy', smoke: false, fire: false, alpha: 1
  });
  assert.equal(vehicleVisualState(createVehicle({kind: 'police'})).frame, 1);
  assert.equal(vehicleVisualState(createVehicle({kind: 'taxi'})).frame, 2);
  assert.equal(vehicleVisualState(createVehicle({kind: 'r33'})).frame, 3);
  assert.equal(vehicleVisualState(createVehicle({kind: 's15'})).frame, 4);
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

function explosion(kind: NetworkExplosion['kind']): NetworkExplosion {
  return {
    id: `explosion-${kind}`, kind, sourceId: 'driver', sourceKind: 'player',
    x: 0, y: 0, radius: 130, createdAt: 1000, expiresAt: 1650
  };
}

function pickup(overrides: Partial<NetworkWeaponPickup> = {}): NetworkWeaponPickup {
  return {
    id: 'pickup', weapon: 'grenade', x: 100, y: 120,
    quantity: 3, available: true, respawnAt: 0, ...overrides
  };
}

test('pedestrian presentation differentiates startle, flee, assault, investigation, and recovery', () => {
  assert.deepEqual(pedestrianMotionPresentation('startle', 0), {
    animate: false, timeScale: 1, tint: 0xffd6a0, alpha: 1
  });
  assert.equal(pedestrianMotionPresentation('flee', 2).timeScale, 1.55);
  assert.equal(pedestrianMotionPresentation('assault', 2).tint, 0xff7a66);
  assert.equal(pedestrianMotionPresentation('investigate', 2).timeScale, 0.82);
  assert.equal(pedestrianMotionPresentation('recover', 0).animate, false);
  assert.equal(pedestrianMotionPresentation('dead', 0).alpha, 0);
});

test('NPC melee presentation is progress-driven through windup, contact, and recovery', () => {
  const windup = npcMeleePresentation({action: 'melee', attackProgress: 0.2});
  const contact = npcMeleePresentation({action: 'melee', attackProgress: 210 / 520});
  const recovery = npcMeleePresentation({action: 'melee', attackProgress: 0.8});
  assert.equal(windup.active, true);
  assert.equal(windup.stopMovement, true);
  assert.ok(windup.rotationOffset < 0);
  assert.ok(contact.rotationOffset > 0.4);
  assert.ok(contact.scaleX > 1.15);
  assert.ok(recovery.rotationOffset > 0 && recovery.rotationOffset < contact.rotationOffset);
  assert.equal(npcMeleePresentation({action: 'assault', attackProgress: 0.2}).active, false);
  assert.equal(npcMeleePresentation({action: 'melee', attackProgress: 1}).active, false);
});

test('actor burn presentation is replicated-state gated and locally animated', () => {
  assert.equal(actorBurnPresentation({id: 'ped', alive: true, onFire: false}, 1000).visible, false);
  assert.equal(actorBurnPresentation({id: 'ped', alive: false, onFire: true}, 1000).visible, false);
  const first = actorBurnPresentation({id: 'ped', alive: true, onFire: true}, 1000);
  const second = actorBurnPresentation({id: 'ped', alive: true, onFire: true}, 1120);
  assert.equal(first.visible, true);
  assert.ok(first.alpha > 0.4 && first.alpha < 0.8);
  assert.notEqual(first.scaleY, second.scaleY);
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
    tyreDamageMask: 0,
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
