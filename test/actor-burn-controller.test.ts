import assert from 'node:assert/strict';
import test from 'node:test';
import {ActorBurnController} from '../server/game/combat/actor-burn-controller.ts';
import type {DamageController} from '../server/game/combat/damage-controller.ts';
import {DistrictState, NpcState, PlayerState} from '../server/state.ts';

test('actor burns carry attribution and damage on a bounded cadence after leaving ground fire', () => {
  const state = new DistrictState();
  const player = new PlayerState();
  player.id = 'player';
  state.players.set(player.id, player);
  const npc = new NpcState();
  npc.id = 'civilian';
  state.npcs.set(npc.id, npc);
  const playerDamage: Array<{id: string; amount: number; sourceId: string; nowMs: number}> = [];
  const npcDamage: Array<{id: string; amount: number; sourceId: string; nowMs: number}> = [];
  const controller = new ActorBurnController({
    state,
    damage: {
      player: (target: PlayerState, amount: number, sourceId: string, nowMs: number) => {
        playerDamage.push({id: target.id, amount, sourceId, nowMs});
      },
      npc: (target: NpcState, amount: number, sourceId: string, nowMs: number) => {
        npcDamage.push({id: target.id, amount, sourceId, nowMs});
      }
    } as unknown as DamageController
  });

  assert.equal(controller.ignitePlayer(player, 'thrower', 1000), true);
  assert.equal(controller.igniteNpc(npc, 'thrower', 1000), true);
  assert.equal(controller.ignitePlayer(player, 'thrower', 1500), false);
  assert.equal(player.fireStartedAt, 1000);
  assert.equal(player.fireExpiresAt, 5000);
  controller.update(1500);
  controller.update(2000);
  controller.update(2250);
  assert.deepEqual(playerDamage, [
    {id: 'player', amount: 4, sourceId: 'thrower', nowMs: 1500},
    {id: 'player', amount: 4, sourceId: 'thrower', nowMs: 2250}
  ]);
  assert.deepEqual(npcDamage, [
    {id: 'civilian', amount: 6, sourceId: 'thrower', nowMs: 1500},
    {id: 'civilian', amount: 6, sourceId: 'thrower', nowMs: 2250}
  ]);
  controller.update(5000);
  assert.equal(player.onFire, false);
  assert.equal(player.fireExpiresAt, 0);
});

test('burn ignition excludes vehicle occupants and clears dead actors', () => {
  const state = new DistrictState();
  const occupant = new PlayerState();
  occupant.id = 'occupant';
  occupant.vehicleId = 'car';
  state.players.set(occupant.id, occupant);
  const npc = new NpcState();
  npc.id = 'civilian';
  state.npcs.set(npc.id, npc);
  const controller = new ActorBurnController({
    state,
    damage: {player: () => undefined, npc: () => undefined} as unknown as DamageController
  });

  assert.equal(controller.ignitePlayer(occupant, 'thrower', 1000), false);
  assert.equal(occupant.onFire, false);
  controller.igniteNpc(npc, 'thrower', 1000);
  npc.alive = false;
  controller.update(1100);
  assert.equal(npc.onFire, false);
  assert.equal(npc.fireStartedAt, 0);
});
