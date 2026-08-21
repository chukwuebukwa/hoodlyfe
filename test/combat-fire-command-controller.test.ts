import assert from 'node:assert/strict';
import test from 'node:test';
import {CombatFireCommandController} from '../server/game/combat/combat-fire-command-controller.ts';
import {DistrictState, PlayerState} from '../server/state.ts';
import {COMBAT_PROTOCOL_VERSION} from '../shared/protocol/combat-fire.ts';

test('combat command adapter accepts each ordered command once without client receipts', () => {
  const state = new DistrictState();
  const player = new PlayerState();
  player.id = 'shooter';
  state.players.set(player.id, player);
  let fired = 0;
  const controller = new CombatFireCommandController({
    state,
    fire: () => {
      fired++;
      return {accepted: true};
    }
  });

  const accepted = controller.accept(player.id, command(1, 900));
  assert.equal(accepted.accepted, true);
  assert.equal(fired, 1);

  assert.equal(controller.accept(player.id, command(1, 900)).reason, 'stale-sequence');
  assert.equal(controller.accept(player.id, command(2, 899)).reason, 'stale-sample-time');
  assert.equal(fired, 1);
  controller.clearPlayer(player.id);
  assert.equal(controller.accept(player.id, command(1, 100)).accepted, true);
  assert.equal(fired, 2);
});

test('combat command adapter rejects forged roots and preserves gameplay rejection reasons', () => {
  const state = new DistrictState();
  const player = new PlayerState();
  player.id = 'shooter';
  state.players.set(player.id, player);
  const controller = new CombatFireCommandController({
    state,
    fire: () => ({accepted: false, reason: 'cooldown-or-empty'})
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
