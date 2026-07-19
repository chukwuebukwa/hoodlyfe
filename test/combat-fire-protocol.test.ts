import assert from 'node:assert/strict';
import test from 'node:test';
import {COMBAT_PROTOCOL_VERSION} from '../shared/protocol/combat-fire.ts';
import {validateCombatFireCommand} from '../shared/protocol/combat-fire.ts';

test('combat fire commands validate sequence, control root, time, aim, and spawn correlation', () => {
  const result = validateCombatFireCommand({
    protocolVersion: COMBAT_PROTOCOL_VERSION,
    sequence: 12,
    clientSampleTimeMs: 12_345.5,
    controlledEntityId: 'player-1',
    aimAngle: Math.PI * 5,
    predictedSpawnIds: [71, 72]
  }, {
    previousSequence: 11,
    expectedControlledEntityId: 'player-1'
  });
  assert.equal(result.accepted, true);
  if (!result.accepted) return;
  assert.ok(Math.abs(result.value.aimAngle - Math.PI) < 1e-12);
  assert.equal(Object.isFrozen(result.value), true);
  assert.equal(Object.isFrozen(result.value.predictedSpawnIds), true);
});

test('combat fire commands fail closed on stale, forged, nonfinite, or duplicate data', () => {
  const command = {
    protocolVersion: COMBAT_PROTOCOL_VERSION,
    sequence: 12,
    clientSampleTimeMs: 12_345,
    controlledEntityId: 'player-1',
    aimAngle: 0,
    predictedSpawnIds: [71]
  };
  const context = {previousSequence: 11, expectedControlledEntityId: 'player-1'};
  assert.equal(validateCombatFireCommand({...command, sequence: 11}, context).accepted, false);
  assert.equal(validateCombatFireCommand({...command, sequence: 50_000}, context).accepted, false);
  assert.equal(validateCombatFireCommand({...command, clientSampleTimeMs: -1}, context).accepted, false);
  assert.equal(validateCombatFireCommand(command, {
    ...context,
    minimumClientSampleTimeMs: 12_346
  }).accepted, false);
  assert.equal(validateCombatFireCommand({...command, aimAngle: Number.NaN}, context).accepted, false);
  assert.equal(validateCombatFireCommand({...command, controlledEntityId: 'vehicle-9'}, context).accepted, false);
  assert.equal(validateCombatFireCommand({...command, predictedSpawnIds: [71, 71]}, context).accepted, false);
  assert.equal(validateCombatFireCommand({...command, protocolVersion: 99}, context).accepted, false);
});
