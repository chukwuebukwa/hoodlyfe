import assert from 'node:assert/strict';
import test from 'node:test';
import {NetworkProbeController} from '../server/game/network/network-probe-controller.ts';

test('network probes echo timing metadata and reject abusive sequences', () => {
  const controller = new NetworkProbeController({region: 'us-east4', buildId: 'build-7'});
  assert.deepEqual(controller.accept('player', {
    sequence: 1,
    clientSentAt: 900
  }, 1_000, 42), {
    sequence: 1,
    clientSentAt: 900,
    serverReceivedAt: 1_000,
    serverTick: 42,
    serverRegion: 'us-east4',
    buildId: 'build-7'
  });
  assert.equal(controller.accept('player', {sequence: 2, clientSentAt: 1_010}, 1_100, 43), undefined);
  assert.equal(controller.accept('player', {sequence: 1, clientSentAt: 1_100}, 1_300, 44), undefined);
  assert.equal(controller.accept('player', {sequence: 20_000, clientSentAt: 1_100}, 1_300, 44), undefined);
  assert.equal(controller.accept('player', {sequence: 2, clientSentAt: 1_100}, 1_300, 44)?.serverTick, 44);
});

test('network probe state is released when a player leaves', () => {
  const controller = new NetworkProbeController({region: 'local', buildId: 'dev'});
  controller.accept('player', {sequence: 7, clientSentAt: 10}, 100, 1);
  controller.clear('player');
  assert.equal(controller.accept('player', {sequence: 1, clientSentAt: 20}, 110, 2)?.sequence, 1);
});
