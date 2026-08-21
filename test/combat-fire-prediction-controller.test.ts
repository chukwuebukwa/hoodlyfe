import assert from 'node:assert/strict';
import test from 'node:test';
import {
  COMBAT_FIRE_MESSAGE,
  COMBAT_FIRE_RECEIPT_MESSAGE,
  COMBAT_PROTOCOL_VERSION,
  type CombatFireCommand,
  type CombatFireReceipt
} from '../shared/protocol/combat-fire.ts';
import {CombatFirePredictionController} from '../src/game/network/combat-fire-prediction-controller.ts';

test('predicted fire presents immediately, reconciles from its receipt, and yields to authority', () => {
  const setup = fixture();
  assert.equal(setup.controller.requestFire(0), true);
  const command = setup.sent[0]?.message as CombatFireCommand;
  assert.equal(setup.sent[0]?.type, COMBAT_FIRE_MESSAGE);
  assert.deepEqual(command.predictedSpawnIds, [1]);
  assert.equal(setup.fired, 1);

  const immediate = setup.controller.update()[0];
  assert.equal(immediate?.phase, 'pending');
  assert.equal(immediate?.x, 118);
  setup.now = 110;
  assert.ok((setup.controller.update()[0]?.x ?? 0) > 118);

  setup.receipt(acceptedReceipt(command, [{
    clientSpawnId: 1,
    authoritativeSpawnId: 'bullet-9',
    status: 'active',
    weapon: 'pistol',
    x: 150,
    y: 25,
    angle: 0.1
  }]));
  assert.deepEqual(setup.controller.update()[0], {
    clientSpawnId: 1,
    commandSequence: 1,
    authoritativeSpawnId: 'bullet-9',
    phase: 'confirmed',
    surfaceId: 'street-ground',
    weapon: 'pistol',
    x: 150,
    y: 25,
    angle: 0.1
  });

  setup.controller.synchronizeAuthoritative(new Map([['bullet-9', {}]]));
  assert.equal(setup.controller.update().length, 0);
});

test('rejected, resolved, and malformed fire receipts retire provisional projectiles', () => {
  const rejected = fixture();
  rejected.controller.requestFire(0);
  const first = rejected.sent[0]?.message as CombatFireCommand;
  rejected.receipt({
    protocolVersion: COMBAT_PROTOCOL_VERSION,
    sequence: first.sequence,
    accepted: false,
    reason: 'cooldown'
  });
  assert.equal(rejected.controller.update().length, 0);

  const resolved = fixture();
  resolved.controller.requestFire(0);
  const second = resolved.sent[0]?.message as CombatFireCommand;
  resolved.receipt(acceptedReceipt(second, [{
    clientSpawnId: second.predictedSpawnIds[0],
    authoritativeSpawnId: 'bullet-wall',
    status: 'resolved',
    weapon: 'pistol',
    x: 122,
    y: 20,
    angle: 0
  }]));
  assert.equal(resolved.controller.update().length, 0);

  const malformed = fixture();
  malformed.player.weapon = 'shotgun';
  malformed.controller.requestFire(0);
  const third = malformed.sent[0]?.message as CombatFireCommand;
  assert.equal(third.predictedSpawnIds.length, 6);
  assert.equal(malformed.controller.update().length, 6);
  malformed.receipt(acceptedReceipt(third, []));
  assert.equal(malformed.controller.update().length, 0);
});

test('predicted fire times out safely and legacy interior fire remains authoritative', () => {
  const setup = fixture();
  setup.controller.requestFire(0);
  setup.now = 1_601;
  assert.equal(setup.controller.update().length, 0);

  const interior = fixture();
  interior.player.spaceId = 'hospital';
  interior.controller.requestFire(0);
  assert.deepEqual(interior.sent, [{type: 'shoot', message: undefined}]);
  assert.equal(interior.controller.update().length, 0);
  assert.equal(interior.fired, 1);
});

function fixture(): {
  controller: CombatFirePredictionController;
  player: {id: string; alive: boolean; spaceId: string; surfaceId: string; weapon: string};
  sent: Array<{type: string; message: unknown}>;
  receipt: (receipt: CombatFireReceipt) => void;
  fired: number;
  now: number;
} {
  const sent: Array<{type: string; message: unknown}> = [];
  let receipt: (message: CombatFireReceipt) => void = () => undefined;
  const player = {
    id: 'local',
    alive: true,
    spaceId: 'street',
    surfaceId: 'street-ground',
    weapon: 'pistol'
  };
  const result = {
    controller: undefined as unknown as CombatFirePredictionController,
    player,
    sent,
    receipt: (message: CombatFireReceipt) => receipt(message),
    fired: 0,
    now: 100
  };
  result.controller = new CombatFirePredictionController({
    room: {
      send: (type: string, message?: unknown) => sent.push({type, message}),
      onMessage: (type: string, handler: (message: CombatFireReceipt) => void) => {
        assert.equal(type, COMBAT_FIRE_RECEIPT_MESSAGE);
        receipt = handler;
        return () => undefined;
      }
    } as never,
    getPlayer: () => player as never,
    getAimOrigin: () => ({x: 100, y: 20}),
    estimatedServerTimeMs: () => 1_000,
    canOccupy: () => true,
    now: () => result.now,
    onPredictedFire: () => result.fired++,
    combatRewindEnabled: () => true,
    projectilePredictionEnabled: () => true
  });
  return result;
}

function acceptedReceipt(
  command: CombatFireCommand,
  projectiles: CombatFireReceipt['projectiles']
): CombatFireReceipt {
  return {
    protocolVersion: COMBAT_PROTOCOL_VERSION,
    sequence: command.sequence,
    accepted: true,
    projectiles
  };
}
