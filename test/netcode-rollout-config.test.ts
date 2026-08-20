import assert from 'node:assert/strict';
import test from 'node:test';
import {resolveNetcodeRolloutManifest} from '../server/game/network/netcode-rollout-config.ts';

test('rollout configuration preserves the current all-on deployment by default', () => {
  const manifest = resolveNetcodeRolloutManifest({});
  assert.equal(manifest.revision, 'server-authority');
  assert.deepEqual(manifest.stages, {
    localOnFootPrediction: true,
    remoteTimelines: true,
    combatRewind: true
  });
});

test('rollout configuration supports independent safe fallbacks and explicit revisions', () => {
  const manifest = resolveNetcodeRolloutManifest({
    GAME_NETCODE_ROLLOUT_REVISION: 'rewind-off',
    GAME_NETCODE_COMBAT_REWIND: 'off'
  });
  assert.equal(manifest.revision, 'rewind-off');
  assert.equal(manifest.stages.remoteTimelines, true);
  assert.equal(manifest.stages.combatRewind, false);
});

test('rollout configuration rejects invalid values', () => {
  assert.throws(
    () => resolveNetcodeRolloutManifest({GAME_NETCODE_REMOTE_TIMELINES: 'maybe'}),
    /must be a boolean rollout flag/
  );
});
