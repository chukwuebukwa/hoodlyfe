import assert from 'node:assert/strict';
import test from 'node:test';
import {StreetEconomyController} from '../server/game/economy/street-economy-controller.ts';
import {GameEventStream, type EntityKilledEvent} from '../server/game/events/game-events.ts';
import {CashPickupController} from '../server/game/pickups/cash-pickup-controller.ts';
import {CASH_PICKUP_POLICY} from '../server/game/pickups/cash-pickup-policy.ts';
import {DistrictState, PlayerState} from '../server/state.ts';
import type {CollisionMap} from '../server/world-map.ts';

test('player death debits once and creates an exact recoverable cash drop', () => {
  const fixture = createFixture();
  const victim = addPlayer(fixture.state, 'victim', 1_000, 40, 60);
  const event = killed(victim.id, 12, 2_000);

  fixture.controller.observeEvents([event, event]);
  assert.equal(victim.cash, 800);
  assert.equal(fixture.state.cashPickups.size, 1);
  const pickup = [...fixture.state.cashPickups.values()][0];
  assert.equal(pickup.amount, 200);
  assert.deepEqual({x: pickup.x, y: pickup.y}, {x: 40, y: 60});
  assert.equal(pickup.availableAt, 3_000);
  assert.equal(pickup.expiresAt, 62_000);

  fixture.controller.observeEvents([event]);
  assert.equal(victim.cash, 800);
  assert.equal(fixture.state.cashPickups.size, 1);
});

test('cash collection waits, resolves contention deterministically, and publishes one event', () => {
  const fixture = createFixture();
  addPlayer(fixture.state, 'victim', 500, 100, 100).alive = false;
  const bravo = addPlayer(fixture.state, 'bravo', 0, 100, 100);
  const alpha = addPlayer(fixture.state, 'alpha', 0, 100, 100);
  fixture.controller.observeEvents([killed('victim', 8, 1_000)]);
  fixture.events.drain();

  fixture.controller.update(1_999);
  assert.equal(fixture.state.cashPickups.size, 1);
  assert.equal(alpha.cash, 0);
  fixture.controller.update(2_000);

  assert.equal(fixture.state.cashPickups.size, 0);
  assert.equal(alpha.cash, 100);
  assert.equal(bravo.cash, 0);
  assert.deepEqual(fixture.notices, ['alpha:CASH +$100']);
  const collected = fixture.events.drain().find((event) => event.type === 'cash-pickup.collected');
  assert.ok(collected && collected.type === 'cash-pickup.collected');
  assert.equal(collected.playerId, 'alpha');
  assert.equal(collected.amount, 100);
});

test('cash drops expire and cannot be collected from vehicles, actions, interiors, or death', () => {
  const fixture = createFixture();
  addPlayer(fixture.state, 'victim', 500, 20, 20).alive = false;
  const collector = addPlayer(fixture.state, 'collector', 0, 20, 20);
  fixture.controller.observeEvents([killed('victim', 2, 100)]);
  collector.vehicleId = 'car';
  fixture.controller.update(1_100);
  collector.vehicleId = '';
  collector.action = 'melee';
  fixture.controller.update(1_200);
  collector.action = '';
  collector.spaceId = 'threads-showroom';
  fixture.controller.update(1_300);
  collector.spaceId = 'street';
  collector.alive = false;
  fixture.controller.update(1_400);
  assert.equal(collector.cash, 0);
  assert.equal(fixture.state.cashPickups.size, 1);

  fixture.controller.update(60_100);
  assert.equal(fixture.state.cashPickups.size, 0);
});

test('drop capacity and full collector balances fail closed without losing money', () => {
  const fixture = createFixture({maximumBalance: 100});
  const victim = addPlayer(fixture.state, 'victim', 100, 0, 0);
  victim.alive = false;
  const collector = addPlayer(fixture.state, 'collector', 100, 0, 0);
  fixture.controller.observeEvents([killed(victim.id, 1, 0)]);
  fixture.controller.update(1_000);
  assert.equal(collector.cash, 100);
  assert.equal(fixture.state.cashPickups.size, 1);

  fixture.state.cashPickups.clear();
  for (let index = 0; index < CASH_PICKUP_POLICY.capacity; index += 1) {
    const dropVictim = addPlayer(fixture.state, `capacity-${index}`, 100, 0, 0);
    fixture.controller.observeEvents([killed(dropVictim.id, index + 10, index + 10)]);
  }
  const blocked = addPlayer(fixture.state, 'blocked', 100, 0, 0);
  fixture.controller.observeEvents([killed(blocked.id, 999, 999)]);
  assert.equal(fixture.state.cashPickups.size, CASH_PICKUP_POLICY.capacity);
  assert.equal(blocked.cash, 100);
});

function createFixture(overrides: {maximumBalance?: number} = {}) {
  const state = new DistrictState();
  const events = new GameEventStream();
  const notices: string[] = [];
  let tick = 0;
  const economy = new StreetEconomyController({
    state,
    events,
    clock: () => ({tick: ++tick}),
    ...overrides
  });
  const controller = new CashPickupController({
    state,
    world: {
      canOccupy: () => true,
      openPointNear: (x: number, y: number) => ({x, y})
    } as unknown as CollisionMap,
    economy,
    events,
    clock: () => ({tick}),
    nearbyPlayers: () => [...state.players.values()],
    notice: (playerId, message) => notices.push(`${playerId}:${message}`)
  });
  return {state, events, notices, controller};
}

function addPlayer(state: DistrictState, id: string, cash: number, x: number, y: number): PlayerState {
  const player = new PlayerState();
  player.id = id;
  player.cash = cash;
  player.x = x;
  player.y = y;
  state.players.set(id, player);
  return player;
}

function killed(entityId: string, tick: number, nowMs: number): EntityKilledEvent {
  return {type: 'entity.killed', entityId, entityKind: 'player', attackerId: '', tick, nowMs};
}
