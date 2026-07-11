import assert from 'node:assert/strict';
import test from 'node:test';
import {NPC_MELEE} from '../shared/content/pedestrian-combat.ts';
import {GameEventStream} from '../server/game/events/game-events.ts';
import {PedestrianMeleeSystem} from '../server/game/pedestrians/pedestrian-melee-system.ts';
import {createPedestrianRuntime} from '../server/game/pedestrians/pedestrian-runtime.ts';
import {DistrictState, NpcState, PlayerState} from '../server/state.ts';
import type {CollisionMap} from '../server/world-map.ts';

test('NPC melee applies one authoritative contact at the impact frame and respects recovery', () => {
  const fixture = createFixture();
  assert.equal(fixture.system.begin(fixture.npc, fixture.runtime, fixture.player, 1_000), true);
  assert.equal(fixture.npc.action, 'melee');
  assert.equal(fixture.npc.attackSequence, 1);
  assert.equal(fixture.npc.attackProgress, 0);
  assert.deepEqual(fixture.events.drain(), [{
    type: 'npc.melee.started',
    tick: 7,
    nowMs: 1_000,
    npcId: fixture.npc.id,
    targetId: fixture.player.id,
    x: fixture.npc.x,
    y: fixture.npc.y
  }]);

  assert.equal(fixture.system.update(fixture.npc, fixture.runtime, 1_209), true);
  assert.equal(fixture.damage.length, 0);
  assert.equal(fixture.runtime.melee.phase, 'windup');
  assert.equal(fixture.system.update(fixture.npc, fixture.runtime, 1_210), true);
  assert.deepEqual(fixture.damage, [{targetId: 'target', amount: 8, attackerId: 'attacker'}]);
  assert.equal(fixture.runtime.melee.phase, 'recovery');
  fixture.system.update(fixture.npc, fixture.runtime, 1_400);
  assert.equal(fixture.damage.length, 1);

  assert.equal(fixture.system.update(fixture.npc, fixture.runtime, 1_520), false);
  assert.equal(fixture.npc.attackProgress, 1);
  assert.equal(fixture.runtime.melee.phase, 'idle');
  assert.equal(fixture.system.begin(fixture.npc, fixture.runtime, fixture.player, 1_939), false);
  assert.equal(fixture.system.begin(fixture.npc, fixture.runtime, fixture.player, 1_940), true);
});

test('NPC melee misses after displacement and cancels invalid targets without delayed contact', () => {
  const fixture = createFixture();
  fixture.system.begin(fixture.npc, fixture.runtime, fixture.player, 1_000);
  fixture.player.y = 100;
  fixture.system.update(fixture.npc, fixture.runtime, 1_210);
  assert.equal(fixture.damage.length, 0);
  assert.equal(fixture.runtime.melee.contactApplied, true);

  fixture.system.clear(fixture.npc, fixture.runtime);
  fixture.player.x = 40;
  fixture.player.y = 0;
  assert.equal(fixture.system.begin(fixture.npc, fixture.runtime, fixture.player, 2_000), true);
  fixture.player.vehicleId = 'escape-car';
  assert.equal(fixture.system.update(fixture.npc, fixture.runtime, 2_100), false);
  assert.equal(fixture.runtime.melee.phase, 'idle');
  fixture.player.vehicleId = '';
  fixture.system.update(fixture.npc, fixture.runtime, 2_500);
  assert.equal(fixture.damage.length, 0);
});

test('NPC melee enforces line of sight and reaction interruption clears the pending strike', () => {
  let visible = false;
  const fixture = createFixture(() => visible);
  assert.equal(fixture.system.begin(fixture.npc, fixture.runtime, fixture.player, 1_000), false);
  visible = true;
  assert.equal(fixture.system.begin(fixture.npc, fixture.runtime, fixture.player, 1_000), true);
  fixture.system.interrupt(fixture.npc, fixture.runtime, 1_100);
  assert.equal(fixture.npc.attackProgress, 1);
  assert.equal(fixture.runtime.melee.phase, 'idle');
  fixture.system.update(fixture.npc, fixture.runtime, 1_500);
  assert.equal(fixture.damage.length, 0);
  assert.equal(fixture.system.begin(fixture.npc, fixture.runtime, fixture.player, 1_519), false);
  assert.equal(fixture.system.begin(fixture.npc, fixture.runtime, fixture.player, 1_520), true);
});

function createFixture(lineOfSight: () => boolean = () => true) {
  const state = new DistrictState();
  const npc = new NpcState();
  npc.id = 'attacker';
  npc.kind = 'hostile';
  npc.x = 0;
  npc.y = 0;
  const player = new PlayerState();
  player.id = 'target';
  player.x = 40;
  player.y = 0;
  state.npcs.set(npc.id, npc);
  state.players.set(player.id, player);
  const runtime = createPedestrianRuntime(0);
  const events = new GameEventStream();
  const damage: Array<{targetId: string; amount: number; attackerId: string}> = [];
  const world = {hasLineOfSight: lineOfSight} as unknown as CollisionMap;
  const system = new PedestrianMeleeSystem({
    state,
    world,
    events,
    clock: () => ({tick: 7}),
    damagePlayer: (target, amount, attackerId) => damage.push({
      targetId: target.id,
      amount,
      attackerId
    })
  });
  assert.equal(NPC_MELEE.damage, 8);
  return {state, npc, player, runtime, events, damage, system};
}
