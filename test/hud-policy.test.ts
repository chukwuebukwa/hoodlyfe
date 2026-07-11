import assert from 'node:assert/strict';
import test from 'node:test';
import {
  hudTransitionNotices,
  hudTransitionState,
  projectLocalHud
} from '../src/game/ui/hud-policy.ts';
import type {NetworkPlayer, NetworkVehicle} from '../src/game/types.ts';
import {cloneAppearance} from '../shared/content/appearance-catalog.ts';

test('local HUD projection covers foot, driver, passenger, damage, and death modes', () => {
  const foot = projectLocalHud(createPlayer(), undefined);
  assert.equal(foot.mode, 'foot');
  assert.equal(foot.showWeaponHud, true);
  assert.equal(foot.showVehicleHud, false);
  assert.equal(foot.weaponName, 'PISTOL');
  assert.equal(foot.weaponAmmo, 120);
  const grenade = projectLocalHud(createPlayer({weapon: 'grenade', ammoGrenade: 4}), undefined);
  assert.equal(grenade.weaponName, 'GRENADE');
  assert.equal(grenade.weaponAmmo, 4);
  assert.equal(grenade.weaponIcon, '/assets/original/weapons/grenade.svg');
  const fists = projectLocalHud(createPlayer({weapon: 'fists'}), undefined);
  assert.equal(fists.weaponName, 'FISTS');
  assert.equal(fists.weaponAmmo, undefined);
  assert.equal(fists.weaponIcon, '/assets/original/weapons/fists.svg');
  const bat = projectLocalHud(createPlayer({weapon: 'bat', action: 'melee'}), undefined);
  assert.equal(bat.weaponName, 'BASEBALL BAT');
  assert.equal(bat.weaponAmmo, undefined);
  assert.equal(bat.weaponIcon, '/assets/original/weapons/bat.svg');
  assert.equal(bat.showWeaponHud, true);

  const driver = projectLocalHud(createPlayer({vehicleId: 'car', vehicleSeat: 0}), createVehicle());
  assert.equal(driver.mode, 'vehicle');
  assert.equal(driver.showVehicleHud, true);
  assert.equal(driver.showWeaponHud, false);
  assert.equal(driver.speed, '055');
  assert.equal(driver.vehicleCondition, 50);

  const passenger = projectLocalHud(createPlayer({vehicleId: 'car', vehicleSeat: 1}), createVehicle());
  assert.equal(passenger.showVehicleHud, false);
  assert.equal(passenger.showWeaponHud, true);

  const dead = projectLocalHud(createPlayer({alive: false, health: -20}), undefined);
  assert.equal(dead.mode, 'dead');
  assert.equal(dead.dead, true);
  assert.equal(dead.health, 0);
  assert.equal(dead.showWeaponHud, false);
});

test('HUD notices are edge-triggered and initial synchronization stays quiet', () => {
  const initial = hudTransitionState(createPlayer({cash: 500, wanted: 2}));
  assert.deepEqual(hudTransitionNotices(undefined, initial), []);
  const escalation = hudTransitionState(createPlayer({cash: 650, wanted: 3, action: 'hijacking'}));
  assert.deepEqual(hudTransitionNotices(initial, escalation), [
    {message: 'POLICE ESCALATION', tone: 'warning'},
    {message: '+$150', tone: 'success'},
    {message: 'CARJACKING', tone: 'info'}
  ]);
  assert.deepEqual(hudTransitionNotices(escalation, escalation), []);
  assert.deepEqual(hudTransitionNotices(escalation, {
    ...escalation,
    wanted: 0,
    action: 'entering'
  }), [
    {message: 'HEAT LOST', tone: 'success'},
    {message: 'ENTERING', tone: 'info'}
  ]);
});

function createPlayer(overrides: Partial<NetworkPlayer> = {}): NetworkPlayer {
  return {
    id: 'player',
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
    ...overrides,
    appearance: overrides.appearance ?? cloneAppearance()
  };
}

function createVehicle(overrides: Partial<NetworkVehicle> = {}): NetworkVehicle {
  return {
    id: 'car',
    kind: 'sedan',
    x: 0,
    y: 0,
    angle: 0,
    speed: 100,
    health: 500,
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
    driverId: 'player',
    traffic: false,
    hijackBy: '',
    ...overrides
  };
}
