import assert from 'node:assert/strict';
import test from 'node:test';
import {
  resolveNetcodeRolloutManifest,
  resolveServerPhysicsRollout
} from '../server/game/network/netcode-rollout-config.ts';
import {validateNetcodeRolloutManifest} from '../shared/protocol/netcode-rollout.ts';

test('rollout configuration preserves the current all-on deployment by default', () => {
  const manifest = resolveNetcodeRolloutManifest({});
  assert.equal(manifest.revision, 'm11-all-on');
  assert.deepEqual(manifest.stages, {
    remoteTimelines: true,
    interactionSnapshots: true,
    interactionReplay: true,
    combatRewind: true,
    projectilePrediction: true,
    serverVehiclePhysics: true
  });
});

test('rollout configuration supports independent safe fallbacks and explicit revisions', () => {
  const manifest = resolveNetcodeRolloutManifest({
    GAME_NETCODE_ROLLOUT_REVISION: 'islands-off',
    GAME_NETCODE_INTERACTION_REPLAY: 'off',
    GAME_NETCODE_PROJECTILE_PREDICTION: '0'
  });
  assert.equal(manifest.revision, 'islands-off');
  assert.equal(manifest.stages.interactionSnapshots, true);
  assert.equal(manifest.stages.interactionReplay, false);
  assert.equal(manifest.stages.combatRewind, true);
  assert.equal(manifest.stages.projectilePrediction, false);
});

test('the vehicle physics stage rides the manifest and older manifests validate as off', () => {
  const enabled = resolveNetcodeRolloutManifest({GAME_NETCODE_SERVER_VEHICLE_PHYSICS: 'on'});
  assert.equal(enabled.stages.serverVehiclePhysics, true);
  const legacyShape = validateNetcodeRolloutManifest({
    protocolVersion: enabled.protocolVersion,
    interactionProtocolVersion: enabled.interactionProtocolVersion,
    revision: 'older-server',
    stages: {
      remoteTimelines: true,
      interactionSnapshots: true,
      interactionReplay: true,
      combatRewind: true,
      projectilePrediction: true
    }
  });
  assert.equal(legacyShape.accepted && legacyShape.value.stages.serverVehiclePhysics, false);
});

test('server physics rollout defaults on with the flag as the rollback lever', () => {
  assert.deepEqual(resolveServerPhysicsRollout({}), {vehicles: true});
  assert.deepEqual(
    resolveServerPhysicsRollout({GAME_NETCODE_SERVER_VEHICLE_PHYSICS: 'off'}),
    {vehicles: false}
  );
  assert.deepEqual(
    resolveServerPhysicsRollout({GAME_NETCODE_SERVER_VEHICLE_PHYSICS: '0'}),
    {vehicles: false}
  );
  assert.throws(
    () => resolveServerPhysicsRollout({GAME_NETCODE_SERVER_VEHICLE_PHYSICS: 'maybe'}),
    /must be a boolean rollout flag/
  );
});

test('rollout configuration rejects invalid values and impossible dependency graphs', () => {
  assert.throws(
    () => resolveNetcodeRolloutManifest({GAME_NETCODE_REMOTE_TIMELINES: 'maybe'}),
    /must be a boolean rollout flag/
  );
  assert.throws(
    () => resolveNetcodeRolloutManifest({
      GAME_NETCODE_INTERACTION_SNAPSHOTS: 'off',
      GAME_NETCODE_INTERACTION_REPLAY: 'on'
    }),
    /invalid-dependencies/
  );
  assert.throws(
    () => resolveNetcodeRolloutManifest({
      GAME_NETCODE_COMBAT_REWIND: 'off',
      GAME_NETCODE_PROJECTILE_PREDICTION: 'on'
    }),
    /invalid-dependencies/
  );
});
