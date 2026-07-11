import assert from 'node:assert/strict';
import test from 'node:test';
import {DamageController} from '../server/game/combat/damage-controller.ts';
import {GameEventStream} from '../server/game/events/game-events.ts';
import {NpcState, PlayerState} from '../server/state.ts';

test('mission hostile damage emits combat facts without street crime, cash, panic, or respawn', () => {
  const events = new GameEventStream();
  const credits: unknown[] = [];
  const crimes: unknown[] = [];
  const panic: unknown[] = [];
  const respawns: unknown[] = [];
  const playerDeaths: unknown[] = [];
  const damage = new DamageController({
    events,
    economy: {credit: (...args: unknown[]) => { credits.push(args); return {status: 'applied'}; }} as any,
    crime: {record: (...args: unknown[]) => crimes.push(args)} as any,
    playerLifecycle: {kill: (...args: unknown[]) => playerDeaths.push(args)} as any,
    clock: () => ({tick: 7}),
    panicNpc: (...args) => panic.push(args),
    scheduleNpcRespawn: (...args) => respawns.push(args)
  });
  const hostile = new NpcState();
  hostile.id = 'mission:hostile:1';
  hostile.kind = 'hostile';
  hostile.health = 60;

  damage.npc(hostile, 100, 'leader', 1_000);

  assert.equal(hostile.alive, false);
  assert.deepEqual(events.drain().map((event) => event.type), [
    'damage.applied',
    'entity.killed'
  ]);
  assert.deepEqual(credits, []);
  assert.deepEqual(crimes, []);
  assert.deepEqual(panic, []);
  assert.deepEqual(respawns, []);

  const player = new PlayerState();
  player.id = 'leader';
  player.health = 25;
  player.armor = 0;
  damage.player(player, 25, hostile.id, 1_100, 'assault', 'non-player');
  const playerEvents = events.drain();
  assert.equal(playerEvents[0]?.type, 'damage.applied');
  if (playerEvents[0]?.type === 'damage.applied') {
    assert.equal(playerEvents[0].attackerId, hostile.id);
  }
  assert.equal(playerDeaths.length, 1);
  assert.deepEqual(credits, []);
  assert.deepEqual(crimes, []);
});

test('self-inflicted explosive damage never creates crime or kill rewards', () => {
  const events = new GameEventStream();
  const credits: unknown[] = [];
  const crimes: unknown[] = [];
  const deaths: unknown[] = [];
  const damage = new DamageController({
    events,
    economy: {credit: (...args: unknown[]) => { credits.push(args); return {status: 'applied'}; }} as any,
    crime: {record: (...args: unknown[]) => crimes.push(args)} as any,
    playerLifecycle: {kill: (...args: unknown[]) => deaths.push(args)} as any,
    clock: () => ({tick: 8}),
    panicNpc: () => undefined,
    scheduleNpcRespawn: () => undefined
  });
  const player = new PlayerState();
  player.id = 'thrower';
  player.health = 100;
  player.armor = 0;

  damage.player(player, 120, player.id, 1200);

  assert.equal(player.health, 0);
  assert.equal(deaths.length, 1);
  assert.deepEqual(credits, []);
  assert.deepEqual(crimes, []);
});
