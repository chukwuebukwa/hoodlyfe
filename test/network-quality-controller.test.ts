import assert from 'node:assert/strict';
import test from 'node:test';
import {NetworkQualityController} from '../src/game/network/network-quality-controller.ts';
import {NETWORK_PING_MESSAGE, NETWORK_PONG_MESSAGE} from '../shared/protocol/network-quality.ts';

test('network quality samples probes, patch gaps, and remote interpolation health', () => {
  let now = 0;
  const sent: Array<{type: string; message: unknown}> = [];
  let pong: (message: any) => void = () => {};
  let stateChanged: (state?: any) => void = () => {};
  const room = {
    send: (type: string, message: unknown) => sent.push({type, message}),
    onMessage: (type: string, handler: (message: any) => void) => {
      assert.equal(type, NETWORK_PONG_MESSAGE);
      pong = handler;
      return () => {};
    },
    onStateChange: (handler: (state?: any) => void) => {
      stateChanged = handler;
      return () => {};
    }
  } as any;
  const controller = new NetworkQualityController(room, {now: () => now});

  controller.update();
  assert.equal(sent[0]?.type, NETWORK_PING_MESSAGE);
  assert.deepEqual(sent[0]?.message, {sequence: 1, clientSentAt: 0});
  now = 80;
  pong({
    sequence: 1,
    clientSentAt: 0,
    serverReceivedAt: 45,
    serverTick: 90,
    serverRegion: 'us-east4',
    buildId: 'abcdef123456789'
  });
  now = 100;
  stateChanged({serverTimeMs: 100, serverTick: 91});
  now = 150;
  stateChanged({serverTimeMs: 150, serverTick: 92});
  now = 230;
  stateChanged({serverTimeMs: 230, serverTick: 94});
  controller.observeRemoteTimeline({
    snapshotAgeMs: 70,
    bufferUnderrun: false,
    mode: 'interpolated'
  });
  controller.observeRemoteTimeline({
    snapshotAgeMs: 130,
    bufferUnderrun: true,
    mode: 'held'
  });
  assert.deepEqual(controller.snapshot(), {
    region: 'us-east4',
    buildId: 'abcdef123456',
    rttMedianMs: 80,
    rttP95Ms: 80,
    jitterMs: 0,
    patchGapP95Ms: 80,
    serverTick: 94,
    clockOffsetMs: 5,
    estimatedServerTimeMs: 235,
    interpolationDelayMs: 120,
    clockSynchronized: true,
    remoteSnapshotAgeP95Ms: 130,
    remoteBufferUnderrunPercent: 50,
    remoteExtrapolationPercent: 0
  });
  controller.destroy();
});
