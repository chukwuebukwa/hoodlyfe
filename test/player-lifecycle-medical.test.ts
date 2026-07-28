import assert from 'node:assert/strict';
import test from 'node:test';
import {DamageController} from '../server/game/combat/damage-controller.ts';
import {GameEventStream} from '../server/game/events/game-events.ts';
import {PlayerLifecycleController} from '../server/game/players/player-lifecycle-controller.ts';
import {DistrictState, PlayerState} from '../server/state.ts';

test('public medical respawn preserves ammo and grants bounded damage protection', () => {
  const fixture = createLifecycle(false);
  fixture.player.ammoPistol = 17;
  fixture.lifecycle.kill(fixture.player, 1000, 'hostile');
  assert.equal(fixture.player.alive, false);
  assert.equal(fixture.lifecycle.tryRespawn(fixture.player, 2000), true);
  assert.equal(fixture.player.alive, true);
  assert.equal(fixture.player.ammoPistol, 17);
  assert.equal(fixture.player.spawnProtected, true);
  assert.equal(fixture.player.spaceId, 'mercy-hospital');

  fixture.damage.player(fixture.player, 25, 'hostile', 3000, 'assault', 'non-player');
  assert.equal(fixture.player.health, 100);
  assert.equal(fixture.events.size, 2, 'Protected damage must not add to kill/respawn events.');
  fixture.lifecycle.updateProtection(fixture.player, 5001);
  assert.equal(fixture.player.spawnProtected, false);
  fixture.damage.player(fixture.player, 25, 'hostile', 5001, 'assault', 'non-player');
  assert.equal(fixture.player.health, 75);
});

test('trauma medical respawn restores ammunition and offensive action cancels protection', () => {
  const fixture = createLifecycle(true);
  fixture.player.ammoPistol = 1;
  fixture.player.ammoSmg = 2;
  fixture.player.ammoShotgun = 3;
  fixture.lifecycle.kill(fixture.player, 1000, 'hostile');
  fixture.lifecycle.tryRespawn(fixture.player, 2000);
  assert.equal(fixture.player.ammoPistol, 108);
  assert.equal(fixture.player.ammoSmg, 210);
  assert.equal(fixture.player.ammoShotgun, 42);
  assert.equal(fixture.player.magazinePistol, 12);
  assert.equal(fixture.player.magazineSmg, 30);
  assert.equal(fixture.player.magazineShotgun, 6);
  fixture.lifecycle.cancelProtection(fixture.player.id);
  assert.equal(fixture.lifecycle.isProtected(fixture.player.id, 2001), false);
  assert.equal(fixture.player.spawnProtected, false);
});

test('competitive damage suppresses freeroam crime and kill payouts', () => {
  const fixture = createLifecycle(false, false);
  fixture.damage.player(fixture.player, 200, 'fighter-2', 1_000);
  assert.equal(fixture.player.alive, false);
  assert.deepEqual(fixture.credits, []);
  assert.deepEqual(fixture.crimes, []);
  assert.equal(fixture.events.drain().some((event) => event.type === 'entity.killed'), true);
});

function createLifecycle(restoreAmmo: boolean, streetConsequencesEnabled = true) {
  const state = new DistrictState();
  const events = new GameEventStream();
  const credits: Array<{playerId: string; amount: number}> = [];
  const crimes: Array<{playerId: string; kind: string}> = [];
  const player = new PlayerState();
  player.id = 'driver';
  state.players.set(player.id, player);
  const medical = {
    begin(target: PlayerState) {
      target.respawnAt = 2000;
      target.respawnCare = restoreAmmo ? 'trauma' : 'public';
    },
    complete() {
      return {
        x: 100,
        y: 120,
        angle: 0,
        spaceId: 'mercy-hospital',
        care: 'public' as const,
        restoreAmmo
      };
    },
    clearPlayer() {}
  };
  const lifecycle = new PlayerLifecycleController({
    state,
    events,
    access: {removePlayer() {}, clearAction() {}} as any,
    crime: {clearSuspect() {}} as any,
    medical,
    custody: {resolve() { throw new Error('Custody is not used by medical lifecycle tests.'); }},
    clock: () => ({tick: 4}),
    resetInput() {}
  });
  const damage = new DamageController({
    events,
    economy: {
      credit: (playerId: string, amount: number) => {
        credits.push({playerId, amount});
        return {status: 'applied'};
      }
    } as any,
    crime: {
      record(playerId: string, kind: string) {
        crimes.push({playerId, kind});
      }
    } as any,
    playerLifecycle: lifecycle,
    streetConsequencesEnabled: () => streetConsequencesEnabled,
    clock: () => ({tick: 5}),
    panicNpc() {},
    scheduleNpcRespawn() {}
  });
  return {state, events, player, lifecycle, damage, credits, crimes};
}
