import assert from 'node:assert/strict';
import test from 'node:test';
import {
  NETCODE_ROLLOUT_PROTOCOL_VERSION,
  createNetcodeRolloutManifest,
  validateNetcodeRolloutManifest,
  validateNetcodeRolloutRequest
} from '../shared/protocol/netcode-rollout.ts';

const ALL_ON = Object.freeze({
  localOnFootPrediction: true,
  localVehiclePrediction: true,
  remoteTimelines: true,
  combatRewind: true,
  interactionSnapshots: true,
  interactionSelection: true,
  vehicleIslandReplay: true,
  mixedIslandReplay: true
});

test('rollout requests and manifests are versioned, validated, and deeply frozen', () => {
  assert.equal(NETCODE_ROLLOUT_PROTOCOL_VERSION, 6);
  assert.equal(validateNetcodeRolloutRequest({protocolVersion: NETCODE_ROLLOUT_PROTOCOL_VERSION}), true);
  assert.equal(validateNetcodeRolloutRequest({protocolVersion: 1}), false);
  assert.equal(validateNetcodeRolloutRequest({protocolVersion: 99}), false);
  const manifest = createNetcodeRolloutManifest('canary-17', ALL_ON);
  const accepted = validateNetcodeRolloutManifest(manifest);
  assert.equal(accepted.accepted, true);
  if (!accepted.accepted) return;
  assert.equal(Object.isFrozen(accepted.value), true);
  assert.equal(Object.isFrozen(accepted.value.stages), true);
  assert.equal(accepted.value.revision, 'canary-17');
  assert.deepEqual(validateNetcodeRolloutManifest({...manifest, protocolVersion: 1}), {
    accepted: false,
    reason: 'unsupported-version'
  });
});

test('interaction stages require their safe rollout predecessors', () => {
  const base = {...ALL_ON};
  assert.deepEqual(validateNetcodeRolloutManifest({
    ...createNetcodeRolloutManifest('base', ALL_ON),
    stages: {...base, interactionSnapshots: false}
  }), {accepted: false, reason: 'invalid-dependencies'});
  assert.deepEqual(validateNetcodeRolloutManifest({
    ...createNetcodeRolloutManifest('base', ALL_ON),
    stages: {...base, interactionSelection: false}
  }), {accepted: false, reason: 'invalid-dependencies'});
  assert.deepEqual(validateNetcodeRolloutManifest({
    ...createNetcodeRolloutManifest('base', ALL_ON),
    stages: {...base, vehicleIslandReplay: false}
  }), {accepted: false, reason: 'invalid-dependencies'});
});

test('rollout admission fails closed on malformed stages', () => {
  const missingStage = validateNetcodeRolloutManifest({
    ...createNetcodeRolloutManifest('base', ALL_ON),
    stages: {remoteTimelines: true}
  });
  assert.deepEqual(missingStage, {accepted: false, reason: 'invalid-stages'});
  assert.throws(
    () => createNetcodeRolloutManifest('bad revision!', ALL_ON),
    /invalid-revision/
  );
});
