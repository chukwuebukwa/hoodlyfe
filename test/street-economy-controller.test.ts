import assert from 'node:assert/strict';
import test from 'node:test';
import {StreetEconomyController} from '../server/game/economy/street-economy-controller.ts';
import {GameEventStream} from '../server/game/events/game-events.ts';
import {DistrictState, PlayerState} from '../server/state.ts';

test('street economy applies credits and debits once with an auditable event', () => {
  const fixture = createEconomy();
  assert.equal(fixture.economy.credit('driver', 750, 'mission-payout', 'mission:1:driver', 100).status, 'applied');
  assert.equal(fixture.player.cash, 750);
  assert.equal(fixture.economy.debit('driver', 125, 'ammunition', 'ammo:driver:1', 200).status, 'applied');
  assert.equal(fixture.player.cash, 625);
  assert.equal(fixture.economy.credit('driver', 750, 'mission-payout', 'mission:1:driver', 300).status, 'duplicate');
  assert.equal(fixture.player.cash, 625);
  assert.equal(fixture.economy.size, 2);
  assert.deepEqual(fixture.economy.snapshot(0), []);
  assert.deepEqual(fixture.economy.snapshot(1).map((transaction) => transaction.id), ['ammo:driver:1']);
  assert.deepEqual(fixture.events.drain().map((event) => (
    event.type === 'economy.changed'
      ? [event.direction, event.reason, event.amount, event.balance]
      : [event.type]
  )), [
    ['credit', 'mission-payout', 750, 750],
    ['debit', 'ammunition', 125, 625]
  ]);
});

test('failed debits do not consume their idempotency key', () => {
  const fixture = createEconomy();
  assert.equal(
    fixture.economy.debit('driver', 100, 'vehicle-repair', 'repair:1', 100).status,
    'insufficient-funds'
  );
  fixture.economy.credit('driver', 100, 'player-kill', 'kill:1', 200);
  assert.equal(fixture.economy.debit('driver', 100, 'vehicle-repair', 'repair:1', 300).status, 'applied');
  assert.equal(fixture.player.cash, 0);
});

test('street economy validates amounts, caps balances, and fails closed at capacity', () => {
  const fixture = createEconomy({maximumBalance: 100, transactionCapacity: 2});
  assert.equal(fixture.economy.credit('missing', 10, 'player-kill', 'missing', 10).status, 'player-missing');
  assert.equal(fixture.economy.credit('driver', -1, 'player-kill', 'bad', 10).status, 'invalid');
  assert.equal(fixture.economy.credit('driver', 1, 'player-kill', 'past', -1).status, 'invalid');
  const capped = fixture.economy.credit('driver', 150, 'player-kill', 'credit:1', 20);
  assert.equal(capped.status, 'applied');
  assert.equal(capped.transaction?.amount, 100);
  assert.equal(fixture.economy.credit('driver', 1, 'player-kill', 'credit:2', 30).status, 'balance-limit');
  assert.equal(fixture.economy.debit('driver', 10, 'ammunition', 'debit:1', 40).status, 'applied');
  assert.equal(fixture.economy.credit('driver', 1, 'player-kill', 'credit:3', 50).status, 'capacity-exceeded');
  assert.equal(fixture.economy.credit('driver', 150, 'player-kill', 'credit:1', 60).status, 'duplicate');
});

function createEconomy(overrides: {maximumBalance?: number; transactionCapacity?: number} = {}) {
  const state = new DistrictState();
  const events = new GameEventStream();
  const player = new PlayerState();
  player.id = 'driver';
  state.players.set(player.id, player);
  let tick = 0;
  const economy = new StreetEconomyController({
    state,
    events,
    clock: () => ({tick: ++tick}),
    ...overrides
  });
  return {state, events, player, economy};
}
