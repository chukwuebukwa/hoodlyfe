import assert from 'node:assert/strict';
import test from 'node:test';
import {CombatReactionController} from '../server/game/combat/combat-reaction-controller.ts';
import {DistrictState, NpcState, PlayerState} from '../server/state.ts';

test('player reactions replicate progress, suppress restart, and accept stronger upgrades', () => {
  const state = new DistrictState();
  const player = new PlayerState();
  player.id = 'driver';
  player.angle = 0;
  player.action = 'entering';
  player.actionVehicleId = 'car';
  state.players.set(player.id, player);
  const interrupted: string[] = [];
  const controller = new CombatReactionController({
    state,
    interruptPlayer: (target) => {
      interrupted.push(target.action);
      target.action = '';
      target.actionVehicleId = '';
    }
  });

  assert.equal(controller.player(player, impact('melee', 'medium', 20, 0), result(40), 1000), true);
  assert.equal(player.reactionSequence, 1);
  assert.equal(player.reactionKind, 'stagger');
  assert.equal(player.reactionDirection, 'front');
  assert.equal(player.action, 'hit');
  controller.update(1210);
  assert.equal(player.reactionProgress, 0.5);

  assert.equal(controller.player(player, impact('bullet', 'light', 20, 0), result(10), 1220), false);
  assert.equal(player.reactionSequence, 1, 'An equal-or-weaker hit must not restart the lock.');
  assert.equal(controller.player(player, impact('explosion', 'heavy', -20, 0), result(30), 1230), true);
  assert.equal(player.reactionSequence, 2);
  assert.equal(player.reactionKind, 'knockdown');
  assert.equal(player.reactionDirection, 'back');
  assert.equal(player.action, 'knockdown');
  assert.deepEqual(interrupted, ['entering', 'hit']);

  controller.update(2180);
  assert.equal(player.reactionKind, '');
  assert.equal(player.reactionProgress, 1);
  assert.equal(player.action, '');
});

test('bullet reactions remain visual and do not interrupt player controls or actions', () => {
  const state = new DistrictState();
  const player = new PlayerState();
  player.id = 'driver';
  player.angle = 0;
  state.players.set(player.id, player);
  let interruptionCount = 0;
  const controller = new CombatReactionController({
    state,
    interruptPlayer: () => {
      interruptionCount++;
    }
  });

  assert.equal(controller.player(player, impact('bullet', 'light', 20, 0), result(10), 1000), true);
  assert.equal(player.reactionKind, 'flinch');
  assert.equal(player.action, '');
  assert.equal(interruptionCount, 0);

  controller.update(1100);
  player.action = 'entering';
  player.actionVehicleId = 'car';
  player.actionUntil = 1500;
  assert.equal(controller.player(player, impact('bullet', 'light', 20, 0), result(10), 1200), true);
  assert.equal(player.action, 'entering');
  assert.equal(player.actionVehicleId, 'car');
  assert.equal(player.actionUntil, 1500);
  assert.equal(interruptionCount, 0);
});

test('NPC reactions pause through their replicated deadline and clear on death', () => {
  const state = new DistrictState();
  const npc = new NpcState();
  npc.id = 'civilian';
  state.npcs.set(npc.id, npc);
  const controller = new CombatReactionController({state, interruptPlayer() {}});

  assert.equal(controller.npc(npc, impact('bullet', 'light', 1, 0), result(10), 500), true);
  assert.equal(npc.action, 'flinch');
  controller.update(550);
  assert.equal(npc.reactionProgress, 0.5);
  controller.update(600);
  assert.equal(npc.reactionKind, '');
  assert.equal(npc.action, 'wander');

  controller.npc(npc, impact('vehicle', 'heavy', 1, 0), result(40), 800);
  npc.alive = false;
  controller.update(810);
  controller.clearNpc(npc.id);
  assert.equal(controller.isActive('npc', npc.id), false);
  assert.equal(npc.reactionKind, '');
});

function impact(
  family: 'bullet' | 'melee' | 'explosion' | 'vehicle',
  force: 'light' | 'medium' | 'heavy',
  sourceX: number,
  sourceY: number
) {
  return {family, force, sourceX, sourceY};
}

function result(acceptedDamage: number) {
  return {acceptedDamage, previousHealth: 100, remainingHealth: 100};
}
