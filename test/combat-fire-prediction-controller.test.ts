import assert from 'node:assert/strict';
import test from 'node:test';
import {
  COMBAT_FIRE_MESSAGE,
  COMBAT_FIRE_RECEIPT_MESSAGE,
  type CombatFireCommand,
  type CombatFireReceipt
} from '../shared/protocol/combat-fire.ts';
import {CombatFirePredictionController} from '../src/game/network/combat-fire-prediction-controller.ts';

test('predicted fire presents immediately, corrects from receipt, and yields to authority', () => {
  const setup = fixture();
  assert.equal(setup.controller.requestFire(0), true);
  assert.equal(setup.sent.length, 1);
  assert.equal(setup.sent[0]?.type, COMBAT_FIRE_MESSAGE);
  const command = setup.sent[0]?.message as CombatFireCommand;
  assert.equal(command.sequence, 1);
  assert.equal(command.clientSampleTimeMs, 1_000);
  assert.equal(command.controlledEntityId, 'local');
  assert.deepEqual(command.predictedSpawnIds, [1]);
  assert.equal(setup.fired, 1);

  const immediate = setup.controller.presentations()[0];
  assert.equal(immediate?.phase, 'pending');
  assert.equal(immediate?.x, 118);
  setup.now = 110;
  const advanced = setup.controller.update()[0];
  assert.ok((advanced?.x ?? 0) > 124, 'The presentation advances before a server patch.');

  setup.receipt(acceptedReceipt(command, [{
    clientSpawnId: 1,
    authoritativeSpawnId: 'bullet-9',
    status: 'active',
    weapon: 'pistol',
    x: 150,
    y: 25,
    angle: 0.1
  }]));
  assert.deepEqual(setup.controller.presentations()[0], {
    clientSpawnId: 1,
    commandSequence: 1,
    authoritativeSpawnId: 'bullet-9',
    phase: 'confirmed',
    weapon: 'pistol',
    x: 150,
    y: 25,
    angle: 0.1
  });

  setup.controller.synchronizeAuthoritative(new Map([['bullet-9', {}]]));
  assert.equal(setup.controller.presentations().length, 0, 'Authority and prediction never render together after correlation.');
  assert.equal(setup.controller.metrics().authoritativeHandoffs, 1);
});

test('rejected and immediately resolved commands retire provisional presentation', () => {
  const setup = fixture();
  setup.controller.requestFire(0);
  const first = setup.sent[0]?.message as CombatFireCommand;
  setup.receipt({
    sequence: first.sequence,
    status: 'rejected',
    reason: 'cooldown-or-empty',
    serverTick: 10,
    serverTimeMs: 1_020,
    effectiveServerShotTimeMs: 1_020,
    rewindMs: 0,
    projectiles: []
  });
  assert.equal(setup.controller.presentations().length, 0);
  assert.equal(setup.controller.metrics().rejectedCommands, 1);

  setup.now = 200;
  setup.controller.requestFire(0);
  const second = setup.sent[1]?.message as CombatFireCommand;
  setup.receipt(acceptedReceipt(second, [{
    clientSpawnId: second.predictedSpawnIds[0],
    authoritativeSpawnId: 'bullet-wall',
    status: 'resolved',
    weapon: 'pistol',
    x: 122,
    y: 20,
    angle: 0
  }]));
  assert.equal(setup.controller.presentations().length, 0);
  assert.equal(setup.controller.metrics().resolvedProjectiles, 1);
});

test('shotgun prediction correlates every pellet and malformed cardinality fails closed', () => {
  const setup = fixture();
  setup.player.weapon = 'shotgun';
  setup.controller.requestFire(Math.PI / 2);
  const command = setup.sent[0]?.message as CombatFireCommand;
  assert.equal(command.predictedSpawnIds.length, 6);
  assert.equal(new Set(command.predictedSpawnIds).size, 6);
  assert.equal(setup.controller.presentations().length, 6);

  setup.receipt(acceptedReceipt(command, []));
  assert.equal(setup.controller.presentations().length, 0);
  assert.equal(setup.controller.metrics().malformedReceipts, 1);
});

test('delayed receipts are accepted within the bound and abandoned commands time out', () => {
  const setup = fixture();
  setup.controller.requestFire(0);
  const first = setup.sent[0]?.message as CombatFireCommand;
  setup.now = 1_500;
  setup.controller.update();
  setup.receipt(acceptedReceipt(first, [{
    clientSpawnId: first.predictedSpawnIds[0],
    authoritativeSpawnId: 'late-bullet',
    status: 'active',
    weapon: 'pistol',
    x: 500,
    y: 20,
    angle: 0
  }]));
  assert.equal(setup.controller.metrics().acceptedCommands, 1);

  setup.controller.requestFire(0);
  setup.now = 3_001;
  setup.controller.update();
  assert.equal(setup.controller.metrics().timedOutCommands, 1);
  assert.equal(setup.controller.presentations().length, 0);
});

test('interior fire preserves legacy behavior until historical interior collision is available', () => {
  const setup = fixture();
  setup.player.spaceId = 'hospital';
  setup.controller.requestFire(0);
  assert.deepEqual(setup.sent, [{type: 'shoot', message: undefined}]);
  assert.equal(setup.controller.presentations().length, 0);
});

test('rollout can fall back to legacy authority or disable only local projectile presentation', () => {
  const legacy = fixture({combatRewindEnabled: false});
  legacy.controller.requestFire(0);
  assert.deepEqual(legacy.sent, [{type: 'shoot', message: undefined}]);
  assert.equal(legacy.controller.presentations().length, 0);

  const authorityOnly = fixture({projectilePredictionEnabled: false});
  authorityOnly.controller.requestFire(0);
  assert.equal(authorityOnly.sent[0]?.type, COMBAT_FIRE_MESSAGE);
  assert.equal(authorityOnly.controller.presentations().length, 0);
  assert.equal(authorityOnly.fired, 0);
});

function fixture(features: {
  combatRewindEnabled?: boolean;
  projectilePredictionEnabled?: boolean;
} = {}): {
  controller: CombatFirePredictionController;
  player: any;
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
  const room = {
    send: (type: string, message?: unknown) => sent.push({type, message}),
    onMessage: (type: string, handler: (message: CombatFireReceipt) => void) => {
      assert.equal(type, COMBAT_FIRE_RECEIPT_MESSAGE);
      receipt = handler;
      return () => undefined;
    }
  } as any;
  result.controller = new CombatFirePredictionController({
    room,
    getPlayer: () => player as any,
    getAimOrigin: () => ({x: 100, y: 20}),
    estimatedServerTimeMs: () => 1_000,
    canOccupy: () => true,
    now: () => result.now,
    onPredictedFire: () => result.fired++,
    combatRewindEnabled: () => features.combatRewindEnabled ?? true,
    projectilePredictionEnabled: () => features.projectilePredictionEnabled ?? true
  });
  return result;
}

function acceptedReceipt(
  command: CombatFireCommand,
  projectiles: CombatFireReceipt['projectiles']
): CombatFireReceipt {
  return {
    sequence: command.sequence,
    status: 'accepted',
    serverTick: 10,
    serverTimeMs: 1_020,
    effectiveServerShotTimeMs: 1_000,
    rewindMs: 20,
    projectiles
  };
}
