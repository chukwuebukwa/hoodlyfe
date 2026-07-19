import assert from 'node:assert/strict';
import test from 'node:test';
import {CombatFireCommandController} from '../server/game/combat/combat-fire-command-controller.ts';
import {DistrictState, PlayerState} from '../server/state.ts';
import {COMBAT_PROTOCOL_VERSION} from '../shared/protocol/combat-fire.ts';

test('combat command adapter accepts each ordered command once and returns correlation receipts', () => {
  const state = new DistrictState();
  const player = new PlayerState();
  player.id = 'shooter';
  state.players.set(player.id, player);
  const receipts: any[] = [];
  let fired = 0;
  const controller = new CombatFireCommandController({
    state,
    clock: () => ({tick: 30, nowMs: 1_000}),
    fire: (_playerId, command) => {
      fired++;
      return {
        accepted: true,
        effectiveServerShotTimeMs: 880,
        rewindMs: 120,
        projectiles: [{
          clientSpawnId: command.predictedSpawnIds[0],
          authoritativeSpawnId: 'bullet-9',
          resolved: false,
          weapon: 'pistol',
          x: 120,
          y: 80,
          angle: Math.PI / 4
        }]
      };
    },
    send: (_playerId, receipt) => receipts.push(receipt)
  });

  const accepted = controller.accept(player.id, command(1, 900));
  assert.equal(accepted.status, 'accepted');
  assert.equal(accepted.projectiles[0]?.authoritativeSpawnId, 'bullet-9');
  assert.equal(accepted.projectiles[0]?.status, 'active');
  assert.equal(accepted.projectiles[0]?.weapon, 'pistol');
  assert.equal(accepted.projectiles[0]?.x, 120);
  assert.equal(accepted.rewindMs, 120);
  assert.equal(fired, 1);

  assert.equal(controller.accept(player.id, command(1, 900)).reason, 'stale-sequence');
  assert.equal(controller.accept(player.id, command(2, 899)).reason, 'stale-sample-time');
  assert.equal(fired, 1);
  assert.equal(receipts.length, 3);

  controller.clearPlayer(player.id);
  assert.equal(controller.accept(player.id, command(1, 100)).status, 'accepted');
  assert.equal(fired, 2);
});

test('combat command adapter rejects forged roots and preserves gameplay rejection reasons', () => {
  const state = new DistrictState();
  const player = new PlayerState();
  player.id = 'shooter';
  state.players.set(player.id, player);
  const controller = new CombatFireCommandController({
    state,
    clock: () => ({tick: 1, nowMs: 1_000}),
    fire: () => ({
      accepted: false,
      reason: 'cooldown-or-empty',
      effectiveServerShotTimeMs: 1_000,
      rewindMs: 0,
      projectiles: []
    }),
    send: () => undefined
  });
  assert.equal(controller.accept('other', command(1, 900)).reason, 'invalid-controlled-entity');
  assert.equal(controller.accept(player.id, command(1, 900)).reason, 'cooldown-or-empty');
});

function command(sequence: number, clientSampleTimeMs: number): Record<string, unknown> {
  return {
    protocolVersion: COMBAT_PROTOCOL_VERSION,
    sequence,
    clientSampleTimeMs,
    controlledEntityId: 'shooter',
    aimAngle: 0,
    predictedSpawnIds: [sequence]
  };
}
