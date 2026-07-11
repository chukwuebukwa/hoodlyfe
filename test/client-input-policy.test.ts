import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canRequestPrimaryAttack,
  canUseWeaponControls,
  ClientInputCadence,
  normalizeMovement
} from '../src/game/input/client-input-policy.ts';
import type {NetworkPlayer} from '../src/game/types.ts';
import {cloneAppearance} from '../shared/content/appearance-catalog.ts';

test('client movement normalization preserves analog magnitude and caps combined input', () => {
  assert.deepEqual(normalizeMovement(0.5, 0), {x: 0.5, y: 0});
  assert.deepEqual(normalizeMovement(Number.NaN, Number.POSITIVE_INFINITY), {x: 0, y: 0});
  const diagonal = normalizeMovement(1, 1);
  assert.ok(Math.abs(Math.hypot(diagonal.x, diagonal.y) - 1) < 0.0001);
  const combined = normalizeMovement(1.4, -0.6);
  assert.ok(Math.abs(Math.hypot(combined.x, combined.y) - 1) < 0.0001);
});

test('client input cadence separates movement heartbeat, aim, fire, and weapon gates', () => {
  const cadence = new ClientInputCadence();
  assert.equal(cadence.shouldSendMovement({x: 1, y: 0}, 49), false);
  assert.equal(cadence.shouldSendMovement({x: 1, y: 0}, 50), true);
  assert.equal(cadence.shouldSendMovement({x: 1, y: 0}, 269), false);
  assert.equal(cadence.shouldSendMovement({x: 1, y: 0}, 270), true);
  assert.equal(cadence.shouldSendMovement({x: 0, y: 0}, 300), false);
  assert.equal(cadence.shouldSendMovement({x: 0, y: 0}, 320), true);

  assert.equal(cadence.shouldSendAim(44), false);
  assert.equal(cadence.shouldSendAim(45), true);
  assert.equal(cadence.shouldSendAim(89), false);
  assert.equal(cadence.shouldSendAim(90), true);
  assert.equal(cadence.shouldSendFire(44), false);
  assert.equal(cadence.shouldSendFire(45), true);
  assert.equal(cadence.shouldSendFire(89), false);
  assert.equal(cadence.shouldSendFire(90), true);
  assert.equal(cadence.shouldCycleWeapon(119), false);
  assert.equal(cadence.shouldCycleWeapon(120), true);
  assert.equal(cadence.shouldCycleWeapon(239), false);
  assert.equal(cadence.shouldCycleWeapon(240), true);
});

test('client weapon intent is gated for death, actions, and drivers but allowed for passengers', () => {
  const player = createPlayer();
  assert.equal(canUseWeaponControls(player), true);
  player.alive = false;
  assert.equal(canUseWeaponControls(player), false);
  player.alive = true;
  player.action = 'entering';
  assert.equal(canUseWeaponControls(player), false);
  player.action = '';
  player.vehicleId = 'car';
  player.vehicleSeat = 0;
  assert.equal(canUseWeaponControls(player), false);
  player.vehicleSeat = 1;
  assert.equal(canUseWeaponControls(player), true);
  assert.equal(canUseWeaponControls(undefined), false);

  player.vehicleId = '';
  player.vehicleSeat = -1;
  player.weapon = 'fists';
  player.action = 'melee';
  assert.equal(canUseWeaponControls(player), false);
  assert.equal(canRequestPrimaryAttack(player), true);
  player.weapon = 'pistol';
  assert.equal(canRequestPrimaryAttack(player), false);
  player.action = '';
  assert.equal(canRequestPrimaryAttack(player), true);
  player.vehicleId = 'car';
  player.vehicleSeat = 0;
  assert.equal(canRequestPrimaryAttack(player), false);
});

function createPlayer(): NetworkPlayer {
  return {
    id: 'driver',
    name: 'Driver',
    x: 0,
    y: 0,
    angle: 0,
    health: 100,
    wanted: 0,
    cash: 0,
    alive: true,
    respawnAt: 0,
    vehicleId: '',
    vehicleSeat: -1,
    action: '',
    actionUntil: 0,
    actionVehicleId: '',
    weapon: 'pistol',
    ammoPistol: 120,
    ammoSmg: 240,
    ammoShotgun: 48,
    ammoGrenade: 2,
    appearance: cloneAppearance()
  };
}
