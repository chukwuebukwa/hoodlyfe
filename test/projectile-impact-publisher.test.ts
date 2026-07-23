import assert from 'node:assert/strict';
import test from 'node:test';
import {PROJECTILE_IMPACTS_MESSAGE} from '../shared/protocol/projectile-impacts.ts';
import {ProjectileImpactPublisher} from '../server/game/events/projectile-impact-publisher.ts';
import type {GameEvent} from '../server/game/events/game-events.ts';
import {DistrictState, PlayerState} from '../server/state.ts';

test('projectile impacts are batched only for nearby street players on the same surface', () => {
  const state = new DistrictState();
  state.players.set('near', player('near', 10, 0));
  state.players.set('far', player('far', 2_000, 0));
  state.players.set('inside', player('inside', 10, 0, 'interior:test'));
  const dead = player('dead', 10, 0);
  dead.alive = false;
  state.players.set(dead.id, dead);
  const sent: Array<{clientId: string; type: string; message: unknown}> = [];
  const clients = ['near', 'far', 'inside', 'dead'].map((sessionId) => ({
    sessionId,
    send: (type: string, message: unknown) => sent.push({clientId: sessionId, type, message})
  }));
  const publisher = new ProjectileImpactPublisher({state, clients: () => clients as any});

  publisher.publish([impact()]);

  assert.equal(sent.length, 2);
  assert.equal(sent[0].clientId, 'near');
  assert.equal(sent[1].clientId, 'dead');
  assert.equal(sent[0].type, PROJECTILE_IMPACTS_MESSAGE);
  assert.deepEqual((sent[0].message as {impacts: unknown[]}).impacts, [{
    id: '12:0:bullet-1',
    tick: 12,
    weapon: 'pistol',
    targetKind: 'world',
    targetId: undefined,
    x: 20,
    y: 0,
    angle: 0,
    surfaceId: 'street-ground'
  }]);
});

function impact(): GameEvent {
  return {
    type: 'projectile.impact',
    tick: 12,
    nowMs: 200,
    projectileId: 'bullet-1',
    weapon: 'pistol',
    targetKind: 'world',
    x: 20,
    y: 0,
    angle: 0,
    surfaceId: 'street-ground'
  };
}

function player(id: string, x: number, y: number, spaceId = 'street'): PlayerState {
  const value = new PlayerState();
  value.id = id;
  value.x = x;
  value.y = y;
  value.spaceId = spaceId;
  value.surfaceId = 'street-ground';
  return value;
}
