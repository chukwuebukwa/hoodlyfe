import assert from 'node:assert/strict';
import test from 'node:test';
import {StreetEconomyController} from '../server/game/economy/street-economy-controller.ts';
import {GameEventStream} from '../server/game/events/game-events.ts';
import {PlayerLifecycleController} from '../server/game/players/player-lifecycle-controller.ts';
import {CustodyOutcomeController} from '../server/game/police/custody-outcome-controller.ts';
import {DistrictState, PlayerState} from '../server/state.ts';
import {CollisionMap} from '../server/world-map.ts';

test('busted lifecycle applies custody economy, confiscation, release and protection atomically', () => {
  const state = new DistrictState();
  const events = new GameEventStream();
  const world = CollisionMap.load();
  const player = new PlayerState();
  player.id = 'suspect';
  player.action = 'arrested';
  player.actionUntil = Number.MAX_SAFE_INTEGER;
  player.wanted = 3;
  player.cash = 2000;
  player.weapon = 'rocket';
  player.ammoPistol = 50;
  player.ammoRocket = 3;
  state.players.set(player.id, player);
  const notices: string[] = [];
  const economy = new StreetEconomyController({state, events, clock: () => ({tick: 20})});
  const custody = new CustodyOutcomeController({
    world,
    economy,
    notice: (_playerId, message) => notices.push(message)
  });
  let clearedSuspect = 0;
  let clearedCombat = 0;
  const lifecycle = new PlayerLifecycleController({
    state,
    events,
    access: {
      removePlayer(target: PlayerState) {
        target.vehicleId = '';
        target.vehicleSeat = -1;
        target.action = '';
        target.actionUntil = 0;
        target.actionVehicleId = '';
      }
    } as any,
    crime: {clearSuspect() { clearedSuspect++; }} as any,
    medical: {begin() {}, complete() { throw new Error('not used'); }, clearPlayer() {}},
    custody,
    clock: () => ({tick: 21}),
    resetInput() {},
    clearCombatState() { clearedCombat++; }
  });

  assert.equal(lifecycle.completeArrest(player, 'arrest:suspect:20', 'officer', 3, 5000), true);
  assert.equal(player.cash, 200);
  assert.equal(player.weapon, 'fists');
  assert.equal(player.ammoPistol, 0);
  assert.equal(player.ammoRocket, 0);
  assert.equal(player.wanted, 0);
  assert.equal(player.action, '');
  assert.equal(player.health, 100);
  assert.equal(player.spawnProtected, true);
  assert.equal(world.canOccupy(player.x, player.y, 11), true);
  assert.equal(lifecycle.isProtected(player.id, 7999), true);
  assert.equal(lifecycle.isProtected(player.id, 8000), false);
  assert.equal(clearedSuspect, 1);
  assert.equal(clearedCombat, 1);
  assert.match(notices[0], /\$1800/);
  assert.deepEqual(events.drain().map((event) => event.type), [
    'economy.changed',
    'player.busted'
  ]);
  assert.equal(lifecycle.completeArrest(player, 'arrest:suspect:20', 'officer', 3, 5001), false);
});
