import assert from 'node:assert/strict';
import test from 'node:test';
import {ArenaDeathmatchController} from '../server/game/deathmatch/arena-deathmatch-controller.ts';
import type {StreetEconomyPort} from '../server/game/economy/street-economy-controller.ts';
import {DistrictState, PlayerState} from '../server/state.ts';
import type {
  ArenaDeathmatchDefinition,
  DeathmatchSpawnPose
} from '../shared/content/arena-deathmatch.ts';

const ARENA: ArenaDeathmatchDefinition = {
  id: 'test-yard',
  label: 'Test Yard',
  assetRoot: '/test',
  scoreLimit: 2,
  durationMs: 60_000,
  spawns: [
    {x: 100, y: 100, angle: 0},
    {x: 500, y: 500, angle: Math.PI}
  ]
};

test('deathmatch pins countdown spawns and starts with an authoritative loadout', () => {
  const harness = createHarness();
  const player = playerState('fighter-1');
  harness.state.players.set(player.id, player);
  harness.controller.register(player);

  harness.controller.update(0);
  assert.equal(harness.state.deathmatch.phase, 'countdown');
  assert.equal(player.weapon, 'smg');
  assert.equal(player.health, 100);
  assert.equal(player.armor, 50);
  const heldSpawn = {x: player.x, y: player.y};

  player.x = 900;
  player.y = 900;
  harness.controller.update(1_000);
  assert.deepEqual({x: player.x, y: player.y}, heldSpawn);

  harness.controller.update(5_000);
  assert.equal(harness.state.deathmatch.phase, 'active');
});

test('deathmatch scores eliminations, respawns victims, and pays results once', () => {
  const harness = createHarness();
  const winner = playerState('winner');
  const victim = playerState('victim');
  harness.state.players.set(winner.id, winner);
  harness.state.players.set(victim.id, victim);
  harness.controller.register(winner);
  harness.controller.register(victim);
  harness.controller.update(0);
  harness.controller.update(5_000);

  harness.controller.observeEvents([killEvent(victim.id, winner.id, 6_000)]);
  const winnerEntry = harness.state.deathmatch.entrants.get(winner.id);
  const victimEntry = harness.state.deathmatch.entrants.get(victim.id);
  assert.equal(winnerEntry?.score, 1);
  assert.equal(winnerEntry?.streak, 1);
  assert.equal(victimEntry?.deaths, 1);
  assert.equal(victimEntry?.alive, false);
  assert.equal(victim.respawnAt, 9_000);

  harness.controller.observeEvents([{
    type: 'player.respawned',
    tick: 7,
    nowMs: 9_000,
    playerId: victim.id,
    x: 0,
    y: 0
  }]);
  assert.equal(victimEntry?.alive, true);
  assert.equal(victim.weapon, 'smg');
  assert.notDeepEqual({x: victim.x, y: victim.y}, {x: 0, y: 0});

  harness.controller.observeEvents([killEvent(victim.id, winner.id, 10_000)]);
  assert.equal(harness.state.deathmatch.phase, 'results');
  assert.equal(harness.state.deathmatch.winnerId, winner.id);
  assert.deepEqual(harness.credits.map(({playerId, amount}) => [playerId, amount]), [
    [winner.id, 1_500],
    [victim.id, 300]
  ]);

  harness.controller.update(10_500);
  assert.equal(harness.credits.length, 2, 'results updates must not duplicate payouts');
});

function createHarness(): {
  state: DistrictState;
  controller: ArenaDeathmatchController;
  credits: Array<{playerId: string; amount: number}>;
} {
  const state = new DistrictState();
  const credits: Array<{playerId: string; amount: number}> = [];
  const economy: StreetEconomyPort = {
    credit: (playerId, amount) => {
      credits.push({playerId, amount});
      return {status: 'applied'};
    },
    debit: () => ({status: 'applied'})
  };
  const controller = new ArenaDeathmatchController({
    state,
    arena: ARENA,
    economy,
    relocate: (player, pose) => relocate(player, pose),
    notice: () => undefined
  });
  return {state, controller, credits};
}

function playerState(id: string): PlayerState {
  const player = new PlayerState();
  player.id = id;
  player.name = id;
  return player;
}

function relocate(player: PlayerState, pose: DeathmatchSpawnPose): void {
  player.x = pose.x;
  player.y = pose.y;
  player.angle = pose.angle;
}

function killEvent(entityId: string, attackerId: string, nowMs: number) {
  return {
    type: 'entity.killed' as const,
    tick: nowMs / 1_000,
    nowMs,
    entityId,
    entityKind: 'player' as const,
    attackerId
  };
}
