import assert from 'node:assert/strict';
import test from 'node:test';
import {GameEventStream} from '../server/game/events/game-events.ts';
import {PoliceArrestController} from '../server/game/police/police-arrest-controller.ts';
import type {PoliceTactic} from '../server/game/police/pursuit-coordinator.ts';
import {DistrictState, NpcState, PlayerState} from '../server/state.ts';
import {CollisionMap} from '../server/world-map.ts';

test('authoritative arrest locks both actors and completes once', () => {
  const fixture = createFixture();
  assert.equal(fixture.controller.request('officer', 'suspect', 1000), true);
  assert.equal(fixture.controller.request('officer', 'suspect', 1001), true);
  assert.equal(fixture.player.action, 'arrested');
  assert.equal(fixture.officer.action, 'arrest');
  assert.equal(fixture.controller.holdsOfficer('officer'), true);
  assert.equal(fixture.controller.diagnostics().length, 1);

  fixture.controller.update(3599);
  assert.equal(fixture.completed.length, 0);
  fixture.controller.update(3600);
  assert.deepEqual(fixture.completed, [{arrestId: 'arrest:suspect:12', wantedLevel: 2}]);
  assert.equal(fixture.controller.holdsOfficer('officer'), false);
  assert.deepEqual(fixture.events.drain().map((event) => event.type), [
    'police.arrest-started'
  ]);
});

test('arrest requires the primary tactic and cancels when officer control breaks', () => {
  const contained = createFixture('contain-left');
  assert.equal(contained.controller.request('officer', 'suspect', 1000), false);
  assert.equal(contained.player.action, '');

  const interrupted = createFixture();
  assert.equal(interrupted.controller.request('officer', 'suspect', 1000), true);
  interrupted.officer.reactionKind = 'stagger';
  interrupted.controller.update(1100);
  assert.equal(interrupted.player.action, '');
  assert.equal(interrupted.officer.action, 'pursue');
  assert.equal(interrupted.controller.holdsPlayer('suspect'), false);
  assert.deepEqual(interrupted.events.drain().map((event) => event.type), [
    'police.arrest-started',
    'police.arrest-cancelled'
  ]);
});

function createFixture(role: PoliceTactic['role'] = 'primary') {
  const state = new DistrictState();
  const world = CollisionMap.load();
  const events = new GameEventStream();
  const officer = new NpcState();
  officer.id = 'officer';
  officer.kind = 'police';
  officer.x = world.spawn.x;
  officer.y = world.spawn.y;
  state.npcs.set(officer.id, officer);
  const player = new PlayerState();
  player.id = 'suspect';
  player.x = officer.x + 36;
  player.y = officer.y;
  player.wanted = 2;
  state.players.set(player.id, player);
  const tactic: PoliceTactic = {
    unitId: officer.id,
    unitKind: 'foot',
    suspectId: player.id,
    role,
    phase: role === 'primary' ? 'pursue' : 'contain',
    goalX: player.x,
    goalY: player.y
  };
  const completed: Array<{arrestId: string; wantedLevel: number}> = [];
  const controller = new PoliceArrestController({
    state,
    world,
    events,
    clock: () => ({tick: 12}),
    targetFor: () => ({
      player,
      canSeeTarget: true,
      targetDistance: Math.hypot(player.x - officer.x, player.y - officer.y),
      tactic
    }),
    completeArrest: (target, arrestId, _officerId, wantedLevel) => {
      completed.push({arrestId, wantedLevel});
      target.action = '';
      return true;
    },
    interruptPlayer: () => undefined,
    resetInput: () => undefined,
    recordTactic: () => undefined
  });
  return {controller, completed, events, officer, player};
}
