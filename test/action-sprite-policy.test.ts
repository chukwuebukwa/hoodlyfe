import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ejectedDriverActionSprite,
  npcActionSprite,
  playerActionSprite,
  vehicleDoorAtlasFrame,
  vehicleDoorPresentation,
  vehicleDoorSpriteOffset
} from '../src/game/rendering/action-sprite-policy.ts';
import type {NetworkPlayer, NetworkVehicle} from '../src/game/types.ts';

const player = (overrides: Partial<NetworkPlayer> = {}): NetworkPlayer => ({
  id: 'player-1', name: 'Driver', x: 0, y: 0, angle: 0, health: 100,
  wanted: 0, cash: 0, alive: true, respawnAt: 0, vehicleId: '', vehicleSeat: -1,
  action: '', actionUntil: 0, actionVehicleId: '', weapon: 'fists', ammoPistol: 0,
  ammoSmg: 0, ammoShotgun: 0, ammoGrenade: 0,
  appearance: {
    outfitName: 'Street Fit', bodyType: 'standard', skinTone: 'bronze',
    hairStyle: 'cropped', hairColor: 'charcoal', headwear: 'none', topStyle: 'jacket',
    topColor: 'charcoal', accentColor: 'amber', bottomStyle: 'jeans', bottomColor: 'denim',
    shoeStyle: 'runners', shoeColor: 'white'
  },
  ...overrides
});

const vehicle = (overrides: Partial<NetworkVehicle> = {}): NetworkVehicle => ({
  id: 'car-1', kind: 'sedan', x: 100, y: 100, angle: 0, speed: 0, health: 1000,
  maxHealth: 1000, engineDamage: 0, tyreDamageMask: 0, damageFront: 0, damageRear: 0, damageLeft: 0,
  damageRight: 0, onFire: false, fireStartedAt: 0, destroyed: false, respawnAt: 0,
  driverId: '', traffic: false, hijackBy: '',
  ...overrides
});

test('character action frames cover melee, death, and vehicle entry', () => {
  assert.deepEqual(playerActionSprite(player({action: 'melee', attackProgress: 0.6})), {
    sprite: 'melee', frame: 2
  });
  assert.deepEqual(playerActionSprite(player({alive: false})), {sprite: 'dead', frame: 7});
  assert.deepEqual(npcActionSprite(false, 'dead'), {sprite: 'dead', frame: 7});
  assert.equal(playerActionSprite(player({
    action: 'entering', actionUntil: 10_160
  }), 10_000).frame, 10);
  assert.equal(playerActionSprite(player({
    action: 'hijacking', actionUntil: 999_999
  }), 10_600, 10_000).frame, 10);
});

test('vehicle door state follows actor side and prospective seat', () => {
  const car = vehicle({driverId: 'driver'});
  const entrant = player({
    id: 'entrant', x: 100, y: 140, action: 'entering', actionVehicleId: car.id
  });
  assert.deepEqual(vehicleDoorPresentation(car, [entrant]), {frame: 2, open: true});

  const frontPassenger = player({id: 'front', vehicleId: car.id, vehicleSeat: 1});
  const rearEntrant = player({
    id: 'rear', x: 100, y: 60, action: 'entering', actionVehicleId: car.id
  });
  assert.deepEqual(vehicleDoorPresentation(car, [frontPassenger, rearEntrant]), {
    frame: 3, open: true
  });
});

test('vehicle kinds select their own row in the door atlas', () => {
  assert.equal(vehicleDoorAtlasFrame(vehicle({kind: 'sedan'}), 2), 2);
  assert.equal(vehicleDoorAtlasFrame(vehicle({kind: 'police'}), 2), 7);
  assert.equal(vehicleDoorAtlasFrame(vehicle({kind: 'taxi'}), 4), 14);
  assert.equal(vehicleDoorAtlasFrame(vehicle({kind: 'r33'}), 2), 17);
  assert.equal(vehicleDoorAtlasFrame(vehicle({kind: 's15'}), 2), 22);
  assert.equal(vehicleDoorAtlasFrame(vehicle({kind: 'suv'}), 2), 27);
});

test('vehicle door frames preserve the chassis origin', () => {
  assert.deepEqual(vehicleDoorSpriteOffset(vehicle({kind: 'sedan'}), 0), {x: -19.5, y: 7.5});
  assert.deepEqual(vehicleDoorSpriteOffset(vehicle({kind: 'sedan'}), 4), {x: 15.5, y: 8});
  assert.deepEqual(vehicleDoorSpriteOffset(vehicle({kind: 'taxi'}), 0), {x: -7.5, y: -11.5});
  assert.deepEqual(vehicleDoorSpriteOffset(vehicle({kind: 'police'}), 0), {x: 0.5, y: 0});
  assert.deepEqual(vehicleDoorSpriteOffset(vehicle({kind: 'r33'}), 2), {x: 0.5, y: 1});
  assert.deepEqual(vehicleDoorSpriteOffset(vehicle({kind: 's15'}), 2), {x: 0.5, y: 0.5});
  assert.deepEqual(vehicleDoorSpriteOffset(vehicle({kind: 'suv'}), 2), {x: 0.5, y: 0.5});
  assert.deepEqual(vehicleDoorSpriteOffset(vehicle({kind: 'sedan'}), 99), {x: -19.5, y: 7.5});
});

test('ejected drivers fall, settle, and recover before panic locomotion', () => {
  assert.equal(ejectedDriverActionSprite(10_000, 10_050)?.frame, 4);
  assert.equal(ejectedDriverActionSprite(10_000, 10_520)?.frame, 7);
  assert.equal(ejectedDriverActionSprite(10_000, 10_900)?.frame, 5);
  assert.equal(ejectedDriverActionSprite(10_000, 11_200), undefined);
});
