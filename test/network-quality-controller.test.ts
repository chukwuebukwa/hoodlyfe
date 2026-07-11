import assert from 'node:assert/strict';
import test from 'node:test';
import {NetworkQualityController} from '../src/game/network/network-quality-controller.ts';
import {NETWORK_PING_MESSAGE, NETWORK_PONG_MESSAGE} from '../shared/protocol/network-quality.ts';

test('network quality samples probes, patch gaps, and prediction corrections', () => {
  let now = 0;
  const sent: Array<{type: string; message: unknown}> = [];
  let pong: (message: any) => void = () => {};
  let stateChanged: () => void = () => {};
  const room = {
    send: (type: string, message: unknown) => sent.push({type, message}),
    onMessage: (type: string, handler: (message: any) => void) => {
      assert.equal(type, NETWORK_PONG_MESSAGE);
      pong = handler;
      return () => {};
    },
    onStateChange: (handler: () => void) => {
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
  stateChanged();
  now = 150;
  stateChanged();
  now = 230;
  stateChanged();
  controller.observePrediction(7.25, false);
  controller.observePrediction(182, true);

  assert.deepEqual(controller.snapshot(), {
    region: 'us-east4',
    buildId: 'abcdef123456',
    rttMedianMs: 80,
    rttP95Ms: 80,
    jitterMs: 0,
    patchGapP95Ms: 80,
    serverTick: 90,
    predictionError: 182,
    reconciliations: 1
  });
  controller.destroy();
});
