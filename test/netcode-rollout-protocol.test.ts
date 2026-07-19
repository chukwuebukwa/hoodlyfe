import assert from 'node:assert/strict';
import test from 'node:test';
import {
  NETCODE_ROLLOUT_PROTOCOL_VERSION,
  createNetcodeRolloutManifest,
  validateNetcodeRolloutManifest,
  validateNetcodeRolloutRequest
} from '../shared/protocol/netcode-rollout.ts';

const ALL_ON = Object.freeze({
  remoteTimelines: true,
  interactionSnapshots: true,
  interactionReplay: true,
  combatRewind: true,
  projectilePrediction: true,
  serverVehiclePhysics: true
});

test('rollout requests and manifests are versioned, validated, and deeply frozen', () => {
  assert.equal(validateNetcodeRolloutRequest({protocolVersion: NETCODE_ROLLOUT_PROTOCOL_VERSION}), true);
  assert.equal(validateNetcodeRolloutRequest({protocolVersion: 99}), false);
  const manifest = createNetcodeRolloutManifest('canary-17', ALL_ON);
  const accepted = validateNetcodeRolloutManifest(manifest);
  assert.equal(accepted.accepted, true);
  if (!accepted.accepted) return;
  assert.equal(Object.isFrozen(accepted.value), true);
  assert.equal(Object.isFrozen(accepted.value.stages), true);
  assert.equal(accepted.value.revision, 'canary-17');
});

test('rollout admission fails closed on malformed and dependency-incompatible stages', () => {
  const invalidDependency = validateNetcodeRolloutManifest({
    ...createNetcodeRolloutManifest('base', ALL_ON),
    stages: {...ALL_ON, interactionSnapshots: false}
  });
  assert.deepEqual(invalidDependency, {accepted: false, reason: 'invalid-dependencies'});
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
