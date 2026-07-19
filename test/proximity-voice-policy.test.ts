import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PROXIMITY_VOICE,
  proximityVoiceGain,
  selectProximityVoicePeers,
  type ProximityVoiceActor
} from '../shared/simulation/proximity-voice-policy.ts';

test('proximity voice selects nearest living actors in the same space', () => {
  const listener = actor('local', 0, 0);
  const candidates = [
    listener,
    actor('near', 100, 0),
    actor('far', PROXIMITY_VOICE.subscribeDistance + 1, 0),
    actor('interior', 20, 0, 'interior:bar'),
    {...actor('dead', 10, 0), alive: false}
  ];
  assert.deepEqual(selectProximityVoicePeers(listener, candidates), ['near']);
});

test('proximity voice keeps warm subscriptions through its outer hysteresis radius', () => {
  const listener = actor('local', 0, 0);
  const peer = actor('peer', PROXIMITY_VOICE.subscribeDistance + 40, 0);
  assert.deepEqual(selectProximityVoicePeers(listener, [peer]), []);
  assert.deepEqual(
    selectProximityVoicePeers(listener, [peer], new Set(['peer'])),
    ['peer']
  );
  peer.x = PROXIMITY_VOICE.unsubscribeDistance + 1;
  assert.deepEqual(selectProximityVoicePeers(listener, [peer], new Set(['peer'])), []);
});

test('proximity voice gain is full nearby and fades smoothly to silence', () => {
  assert.equal(proximityVoiceGain(0), 1);
  assert.equal(proximityVoiceGain(PROXIMITY_VOICE.fullVolumeDistance), 1);
  const middle = proximityVoiceGain(
    (PROXIMITY_VOICE.fullVolumeDistance + PROXIMITY_VOICE.audibleDistance) / 2
  );
  assert.ok(middle > 0 && middle < 1);
  assert.equal(proximityVoiceGain(PROXIMITY_VOICE.audibleDistance), 0);
  assert.equal(proximityVoiceGain(Number.NaN), 0);
});

function actor(id: string, x: number, y: number, spaceId = 'street'): ProximityVoiceActor {
  return {id, x, y, spaceId, alive: true};
}
