import assert from 'node:assert/strict';
import test from 'node:test';
import type {GameEvent} from '../server/game/events/game-events.ts';
import {MemoryJournalSink, parseJournal} from '../server/game/journal/journal-sink.ts';
import {SimulationJournal} from '../server/game/journal/simulation-journal.ts';
import {HashStream, hashDistrictState} from '../server/game/journal/state-hash.ts';
import {DistrictState, PlayerState} from '../server/state.ts';

function journalFixture(sink: MemoryJournalSink, hashState: () => number = () => 42) {
  return new SimulationJournal({
    sink,
    seed: 1234,
    epochMs: 1_000_000,
    stepMs: 1000 / 30,
    collisionRevision: 2,
    rolloutRevision: 'server-authority',
    hashState,
    hashIntervalTicks: 10
  });
}

function damageEvent(tick: number): GameEvent {
  return {
    tick,
    nowMs: tick * (1000 / 30),
    type: 'damage.applied',
    attackerId: 'a',
    targetId: 'b',
    targetKind: 'player',
    amount: 10,
    armorDamage: 0,
    healthDamage: 10,
    remainingArmor: 0,
    remainingHealth: 90
  };
}

test('journal writes a header, records in order, and hashes on cadence', () => {
  const sink = new MemoryJournalSink();
  const journal = journalFixture(sink);
  journal.recordSpawn(0, 'session-a', {name: 'Recorder'});
  journal.recordCommand(3, 'session-a', 'aim', {angle: 1.5});
  journal.observeTick(9, [damageEvent(9)]);
  journal.observeTick(10, []);
  journal.recordLeave(12, 'session-a');
  journal.close();

  const recorded = sink.journal();
  assert.equal(recorded.header.seed, 1234);
  assert.equal(recorded.header.epochMs, 1_000_000);
  assert.equal(recorded.header.hashIntervalTicks, 10);
  assert.equal(recorded.header.collisionRevision, 2);
  assert.deepEqual(recorded.records.map((record) => record.kind), [
    'spawn', 'command', 'events', 'hash', 'leave'
  ]);
  const hash = recorded.records.find((record) => record.kind === 'hash');
  assert.deepEqual(hash, {kind: 'hash', tick: 10, value: 42});
});

test('journal skips hash records off cadence and empty event ticks', () => {
  const sink = new MemoryJournalSink();
  const journal = journalFixture(sink);
  for (let tick = 1; tick <= 9; tick++) journal.observeTick(tick, []);
  assert.equal(sink.journal().records.length, 0);
});

test('journal disables itself after a sink failure instead of throwing', () => {
  const failures: unknown[] = [];
  let writes = 0;
  const journal = new SimulationJournal({
    sink: {
      begin: () => {},
      append: () => {
        writes++;
        throw new Error('disk full');
      },
      close: () => {}
    },
    seed: 1,
    epochMs: 0,
    stepMs: 1000 / 30,
    collisionRevision: 2,
    rolloutRevision: 'server-authority',
    hashState: () => 0,
    onFailure: (error) => failures.push(error)
  });
  journal.recordLeave(1, 'session-a');
  journal.recordLeave(2, 'session-a');
  assert.equal(writes, 1);
  assert.equal(failures.length, 1);
});

test('journal text round-trips through parseJournal', () => {
  const sink = new MemoryJournalSink();
  const journal = journalFixture(sink);
  journal.recordCommand(5, 'session-a', 'shoot', undefined);
  journal.close();
  const recorded = sink.journal();
  const text = [recorded.header, ...recorded.records]
    .map((line) => JSON.stringify(line))
    .join('\n');
  const parsed = parseJournal(text);
  assert.deepEqual(parsed.header, recorded.header);
  assert.equal(parsed.records.length, 1);
  assert.equal(parsed.records[0].kind, 'command');
});

test('state hash is stable for identical states and sensitive to changes', () => {
  const build = (): DistrictState => {
    const state = new DistrictState();
    const player = new PlayerState();
    player.id = 'p1';
    player.x = 100.125;
    player.y = 200.5;
    player.cash = 500;
    state.players.set(player.id, player);
    return state;
  };
  const first = build();
  const second = build();
  assert.equal(hashDistrictState(first), hashDistrictState(second));
  second.players.get('p1')!.x += 0.0001;
  assert.notEqual(hashDistrictState(first), hashDistrictState(second));
});

test('state hash is insertion-order independent', () => {
  const build = (order: string[]): DistrictState => {
    const state = new DistrictState();
    for (const id of order) {
      const player = new PlayerState();
      player.id = id;
      player.x = id.length;
      state.players.set(id, player);
    }
    return state;
  };
  assert.equal(
    hashDistrictState(build(['a', 'b', 'c'])),
    hashDistrictState(build(['c', 'a', 'b']))
  );
});

test('hash stream separates adjacent strings', () => {
  const first = new HashStream();
  first.string('ab');
  first.string('c');
  const second = new HashStream();
  second.string('a');
  second.string('bc');
  assert.notEqual(first.value(), second.value());
});
