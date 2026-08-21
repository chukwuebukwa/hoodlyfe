import assert from 'node:assert/strict';
import test from 'node:test';
import {resolveNetcodeRolloutManifest} from '../server/game/network/netcode-rollout-config.ts';

test('rollout configuration preserves the current all-on deployment by default', () => {
  const manifest = resolveNetcodeRolloutManifest({});
  assert.equal(manifest.revision, 'server-authority');
  assert.deepEqual(manifest.stages, {
    localOnFootPrediction: true,
    localVehiclePrediction: true,
    remoteTimelines: true,
    combatRewind: true,
    interactionSnapshots: false,
    interactionSelection: false,
    vehicleIslandReplay: false,
    mixedIslandReplay: false
  });
});

test('interaction rollout can be enabled in dependency order', () => {
  const manifest = resolveNetcodeRolloutManifest({
    GAME_NETCODE_INTERACTION_SNAPSHOTS: 'on',
    GAME_NETCODE_INTERACTION_SELECTION: 'on',
    GAME_NETCODE_VEHICLE_ISLAND_REPLAY: 'on',
    GAME_NETCODE_MIXED_ISLAND_REPLAY: 'on'
  });
  assert.equal(manifest.stages.interactionSnapshots, true);
  assert.equal(manifest.stages.interactionSelection, true);
  assert.equal(manifest.stages.vehicleIslandReplay, true);
  assert.equal(manifest.stages.mixedIslandReplay, true);
});

test('rollout configuration supports independent safe fallbacks and explicit revisions', () => {
  const manifest = resolveNetcodeRolloutManifest({
    GAME_NETCODE_ROLLOUT_REVISION: 'rewind-off',
    GAME_NETCODE_COMBAT_REWIND: 'off'
  });
  assert.equal(manifest.revision, 'rewind-off');
  assert.equal(manifest.stages.remoteTimelines, true);
  assert.equal(manifest.stages.localVehiclePrediction, true);
  assert.equal(manifest.stages.combatRewind, false);
});

test('rollout configuration rejects invalid values', () => {
  assert.throws(
    () => resolveNetcodeRolloutManifest({GAME_NETCODE_REMOTE_TIMELINES: 'maybe'}),
    /must be a boolean rollout flag/
  );
});
