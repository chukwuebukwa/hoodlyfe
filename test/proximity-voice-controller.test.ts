import assert from 'node:assert/strict';
import test from 'node:test';
import {VOICE_PEERS_MESSAGE, VOICE_TOKEN_RESPONSE_MESSAGE} from '../shared/protocol/proximity-voice.ts';
import {PROXIMITY_VOICE} from '../shared/simulation/proximity-voice-policy.ts';
import {ProximityVoiceController} from '../server/game/audio/proximity-voice-controller.ts';
import {DistrictState, PlayerState} from '../server/state.ts';

test('voice authority publishes peer changes with subscription hysteresis', () => {
  const state = new DistrictState();
  const local = player('local', 0);
  const peer = player('peer', PROXIMITY_VOICE.subscribeDistance - 1);
  state.players.set(local.id, local);
  state.players.set(peer.id, peer);
  const sent: Array<{playerId: string; type: string; payload: unknown}> = [];
  const controller = new ProximityVoiceController({
    state,
    roomName: 'voice:test',
    liveKitUrl: 'wss://voice.test',
    liveKitApiKey: 'key',
    liveKitApiSecret: 'secret-that-is-long-enough-for-signing',
    send: (playerId, type, payload) => sent.push({playerId, type, payload})
  });

  controller.synchronize(true);
  assert.deepEqual(peerMessage(sent, 'local'), {peerIds: ['peer']});
  sent.length = 0;
  peer.x = PROXIMITY_VOICE.subscribeDistance + 50;
  controller.synchronize(true);
  assert.equal(sent.length, 0, 'warm peers remain subscribed without another message');
  peer.x = PROXIMITY_VOICE.unsubscribeDistance + 1;
  controller.synchronize(true);
  assert.deepEqual(peerMessage(sent, 'local'), {peerIds: []});
});

test('voice token request fails closed when LiveKit is not configured', async () => {
  const state = new DistrictState();
  state.players.set('local', player('local', 0));
  const sent: Array<{playerId: string; type: string; payload: unknown}> = [];
  const controller = new ProximityVoiceController({
    state,
    roomName: 'voice:test',
    liveKitUrl: '',
    liveKitApiKey: '',
    liveKitApiSecret: '',
    send: (playerId, type, payload) => sent.push({playerId, type, payload})
  });
  await controller.issueToken('local');
  assert.deepEqual(sent, [{
    playerId: 'local',
    type: VOICE_TOKEN_RESPONSE_MESSAGE,
    payload: {enabled: false, reason: 'unconfigured'}
  }]);
});

function peerMessage(
  sent: Array<{playerId: string; type: string; payload: unknown}>,
  playerId: string
): unknown {
  return sent.find((message) => (
    message.playerId === playerId && message.type === VOICE_PEERS_MESSAGE
  ))?.payload;
}

function player(id: string, x: number): PlayerState {
  const value = new PlayerState();
  value.id = id;
  value.name = id;
  value.x = x;
  value.y = 0;
  return value;
}
