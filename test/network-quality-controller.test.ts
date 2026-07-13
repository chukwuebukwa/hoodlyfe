import assert from 'node:assert/strict';
import test from 'node:test';
import {NetworkQualityController} from '../src/game/network/network-quality-controller.ts';
import {NETWORK_PING_MESSAGE, NETWORK_PONG_MESSAGE} from '../shared/protocol/network-quality.ts';

test('network quality samples probes, patch gaps, and prediction corrections', () => {
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
  controller.observePrediction(7.25, false);
  controller.observePrediction(182, true, 4, 27, true);
  controller.observeOnFootPrediction(3, false, 2, 31, true);

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
    predictionError: 3,
    predictionErrorP95: 182,
    predictionErrorMean: 64.1,
    predictionCorrections: 3,
    reconciliations: 1,
    vehicleResimulations: 1,
    vehiclePendingMoves: 4,
    vehicleAcknowledgedMove: 27,
    onFootResimulations: 1,
    onFootPendingMoves: 2,
    onFootAcknowledgedMove: 31
  });
  controller.destroy();
});
