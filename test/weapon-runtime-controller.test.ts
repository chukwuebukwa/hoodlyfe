import assert from 'node:assert/strict';
import test from 'node:test';
import {WeaponRuntimeController} from '../server/game/combat/weapon-runtime-controller.ts';
import {DistrictState, PlayerState} from '../server/state.ts';

test('magazine reload transfers reserve only when its authoritative timer completes', () => {
  const {player, runtime, clock} = fixture();
  player.magazinePistol = 4;
  player.ammoPistol = 18;

  const requested = runtime.requestReload(player.id);
  assert.equal(requested.accepted, true);
  assert.equal(player.reloadWeapon, 'pistol');
  assert.equal(player.reloadEndsAt, 2100);
  runtime.update(2099);
  assert.equal(player.magazinePistol, 4);
  assert.equal(player.ammoPistol, 18);
  runtime.update(2100);
  assert.equal(player.magazinePistol, 12);
  assert.equal(player.ammoPistol, 10);
  assert.equal(player.reloadWeapon, '');

  clock.nowMs = 2200;
  assert.equal(runtime.requestReload(player.id).reason, 'full-magazine');
});

test('shotgun reloads one shell at a time and firing interrupts with loaded shells intact', () => {
  const {player, runtime, clock} = fixture();
  player.weapon = 'shotgun';
  player.magazineShotgun = 0;
  player.ammoShotgun = 3;
  runtime.requestReload(player.id);

  runtime.update(1480);
  assert.equal(player.magazineShotgun, 1);
  assert.equal(player.ammoShotgun, 2);
  assert.equal(player.reloadWeapon, 'shotgun');
  clock.nowMs = 1500;
  const shot = runtime.consumeShot(player, 'shotgun');
  assert.equal(shot.accepted, true);
  assert.equal(player.magazineShotgun, 0);
  assert.equal(player.reloadWeapon, 'shotgun', 'empty shotguns immediately begin the next shell reload');
});

test('reload cancels on weapon switch, action, driving, or death without losing ammunition', () => {
  const {player, runtime} = fixture();
  player.magazineSmg = 5;
  player.ammoSmg = 20;
  player.weapon = 'smg';
  runtime.requestReload(player.id);
  player.weapon = 'pistol';
  runtime.update(3000);
  assert.equal(player.reloadWeapon, '');
  assert.equal(player.magazineSmg, 5);
  assert.equal(player.ammoSmg, 20);

  player.weapon = 'smg';
  runtime.requestReload(player.id);
  player.vehicleId = 'car';
  player.vehicleSeat = 0;
  runtime.update(3000);
  assert.equal(player.reloadWeapon, '');
});

test('repeated empty trigger input never restarts an in-progress automatic reload', () => {
  const {player, runtime, clock} = fixture();
  player.weapon = 'smg';
  player.magazineSmg = 1;
  player.ammoSmg = 10;
  runtime.consumeShot(player, 'smg');
  assert.equal(player.reloadEndsAt, 2500);

  clock.nowMs = 1200;
  assert.equal(runtime.consumeShot(player, 'smg').reason, 'empty-magazine');
  clock.nowMs = 1700;
  assert.equal(runtime.consumeShot(player, 'smg').reason, 'empty-magazine');
  assert.equal(player.reloadEndsAt, 2500);
  runtime.update(2500);
  assert.equal(player.magazineSmg, 10);
  assert.equal(player.ammoSmg, 0);
});

function fixture() {
  const state = new DistrictState();
  const player = new PlayerState();
  player.id = 'shooter';
  state.players.set(player.id, player);
  const clock = {nowMs: 1000};
  const runtime = new WeaponRuntimeController({state, clock: () => clock});
  return {state, player, runtime, clock};
}
