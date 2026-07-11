import assert from 'node:assert/strict';
import test from 'node:test';
import {DamageController} from '../server/game/combat/damage-controller.ts';
import {GameEventStream} from '../server/game/events/game-events.ts';
import {NpcState, PlayerState} from '../server/state.ts';

test('armor-only player contact publishes the complete split and still records assault', () => {
  const fixture = createFixture();
  const player = new PlayerState();
  player.id = 'victim';
  player.armor = 50;
  const impact = {family: 'bullet', force: 'light', sourceX: -10, sourceY: 0} as const;

  fixture.damage.player(player, 25, 'attacker', 1000, 'assault', 'player', impact);

  assert.equal(player.armor, 25);
  assert.equal(player.health, 100);
  assert.equal(fixture.crimes.length, 1);
  assert.equal(fixture.reactions.length, 1);
  assert.deepEqual(fixture.events.drain(), [{
    type: 'damage.applied',
    tick: 7,
    nowMs: 1000,
    targetId: 'victim',
    targetKind: 'player',
    attackerId: 'attacker',
    amount: 25,
    armorDamage: 25,
    healthDamage: 0,
    remainingArmor: 25,
    remainingHealth: 100
  }]);
});

test('damage overflows armor into health and lethal damage preserves lifecycle ownership', () => {
  const fixture = createFixture();
  const player = new PlayerState();
  player.id = 'victim';
  player.health = 40;
  player.armor = 20;
  const impact = {family: 'melee', force: 'heavy', sourceX: 0, sourceY: 0} as const;

  fixture.damage.player(player, 50, 'attacker', 1000, 'assault', 'player', impact);
  assert.equal(player.armor, 0);
  assert.equal(player.health, 10);
  assert.equal(fixture.reactions.length, 1);

  fixture.damage.player(player, 10, 'attacker', 1100, 'assault', 'player', impact);
  assert.equal(player.health, 0);
  assert.equal(fixture.deaths.length, 1);
  assert.equal(fixture.clearedPlayers.at(-1), player.id);
});

test('NPC armor absorbs damage without suppressing panic or reaction', () => {
  const fixture = createFixture();
  const npc = new NpcState();
  npc.id = 'officer';
  npc.kind = 'police';
  npc.health = 100;
  npc.armor = 30;

  fixture.damage.npc(
    npc,
    20,
    'attacker',
    1000,
    undefined,
    {family: 'bullet', force: 'light', sourceX: 5, sourceY: 5}
  );
  assert.equal(npc.armor, 10);
  assert.equal(npc.health, 100);
  assert.equal(fixture.panics.length, 1);
  assert.equal(fixture.reactions.length, 1);
  assert.equal(fixture.crimes.length, 1);
});

function createFixture() {
  const events = new GameEventStream();
  const crimes: unknown[][] = [];
  const reactions: unknown[][] = [];
  const panics: unknown[][] = [];
  const deaths: unknown[][] = [];
  const clearedPlayers: string[] = [];
  const damage = new DamageController({
    events,
    economy: {credit: () => ({status: 'applied'})} as any,
    crime: {record: (...args: unknown[]) => crimes.push(args)} as any,
    playerLifecycle: {kill: (...args: unknown[]) => deaths.push(args)} as any,
    reactions: {
      player: (...args: unknown[]) => { reactions.push(args); return true; },
      npc: (...args: unknown[]) => { reactions.push(args); return true; },
      clearPlayer: (id: string) => clearedPlayers.push(id),
      clearNpc() {}
    },
    clock: () => ({tick: 7}),
    panicNpc: (...args) => panics.push(args),
    scheduleNpcRespawn() {}
  });
  return {events, damage, crimes, reactions, panics, deaths, clearedPlayers};
}
