import assert from 'node:assert/strict';
import test from 'node:test';
import {resolveNetcodeRolloutManifest} from '../server/game/network/netcode-rollout-config.ts';

test('rollout configuration preserves the current all-on deployment by default', () => {
  const manifest = resolveNetcodeRolloutManifest({});
  assert.equal(manifest.revision, 'm11-all-on');
  assert.deepEqual(manifest.stages, {
    remoteTimelines: true,
    interactionSnapshots: true,
    interactionReplay: true,
    combatRewind: true,
    projectilePrediction: true
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
