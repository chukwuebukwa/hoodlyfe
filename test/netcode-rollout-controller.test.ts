import assert from 'node:assert/strict';
import test from 'node:test';
import {
  NETCODE_ROLLOUT_MANIFEST_MESSAGE,
  NETCODE_ROLLOUT_REQUEST_MESSAGE,
  createNetcodeRolloutManifest
} from '../shared/protocol/netcode-rollout.ts';
import {NetcodeRolloutController} from '../src/game/network/netcode-rollout-controller.ts';

const ALL_ON = Object.freeze({
  remoteTimelines: true,
  interactionSnapshots: true,
  interactionReplay: true,
  combatRewind: true,
  projectilePrediction: true,
});

test('client installs its listener before request and enables only negotiated stages', () => {
  const events: string[] = [];
  let receive: (message: unknown) => void = () => undefined;
  let scheduled: (() => void) | undefined;
  const controller = new NetcodeRolloutController({
    onMessage: (type, callback) => {
      events.push(`listen:${type}`);
      receive = callback;
      return () => events.push('removed');
    },
    send: (type) => events.push(`send:${type}`)
  }, {
    schedule: (callback) => {
      scheduled = callback;
      return 1;
    },
    cancel: () => events.push('cancelled')
  });
  assert.deepEqual(events.slice(0, 2), [
    `listen:${NETCODE_ROLLOUT_MANIFEST_MESSAGE}`,
    `send:${NETCODE_ROLLOUT_REQUEST_MESSAGE}`
  ]);
  assert.equal(controller.snapshot().source, 'pending');
  assert.equal(controller.enabled('remoteTimelines'), false);
  receive(createNetcodeRolloutManifest('canary', {...ALL_ON, interactionReplay: false}));
  assert.equal(controller.snapshot().source, 'negotiated');
  assert.equal(controller.enabled('remoteTimelines'), true);
  assert.equal(controller.enabled('interactionReplay'), false);
  scheduled?.();
  assert.equal(controller.snapshot().source, 'negotiated');
  controller.destroy();
  assert.ok(events.includes('removed'));
});

test('missing and invalid server manifests remain on kernel-only fallback behavior', () => {
  let receive: (message: unknown) => void = () => undefined;
  let scheduled: (() => void) | undefined;
  const controller = new NetcodeRolloutController({
    onMessage: (_type, callback) => {
      receive = callback;
      return () => undefined;
    },
    send: () => undefined
  }, {
    schedule: (callback) => {
      scheduled = callback;
      return 1;
    },
    cancel: () => undefined
  });
  scheduled?.();
  assert.equal(controller.snapshot().source, 'legacy-fallback');
  assert.equal(controller.enabled('combatRewind'), false);
  receive({protocolVersion: 999});
  assert.equal(controller.snapshot().source, 'rejected');
  assert.equal(controller.snapshot().rejectionReason, 'unsupported-version');
  assert.equal(controller.enabled('remoteTimelines'), false);
});
