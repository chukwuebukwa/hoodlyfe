import assert from 'node:assert/strict';
import test from 'node:test';
import {GameEventStream} from '../server/game/events/game-events.ts';
import {DeferredCommandQueue} from '../server/game/world/deferred-command-queue.ts';
import {DeterministicRandom} from '../server/game/world/deterministic-random.ts';
import {FixedStepClock} from '../server/game/world/fixed-step-clock.ts';
import {SpatialIndex, type SpatialRecord} from '../server/game/world/spatial-index.ts';

test('fixed-step clock produces stable simulation frames and bounds catch-up work', () => {
  const clock = new FixedStepClock({stepMs: 20, maxCatchUpSteps: 3, maxElapsedMs: 200});
  const frames: Array<{tick: number; nowMs: number}> = [];

  assert.equal(clock.advance(10, (frame) => frames.push(frame)), 0);
  assert.equal(clock.advance(10, (frame) => frames.push(frame)), 1);
  assert.deepEqual(
    frames.map(({tick, nowMs}) => ({tick, nowMs})),
    [{tick: 1, nowMs: 20}]
  );

  assert.equal(clock.advance(100, (frame) => frames.push(frame)), 3);
  assert.equal(clock.tick, 4);
  assert.equal(clock.nowMs, 80);
  assert.equal(clock.droppedMs, 40);

  assert.equal(clock.advance(1000, (frame) => frames.push(frame)), 3);
  assert.equal(clock.tick, 7);
  assert.equal(clock.droppedMs, 980);
});

test('keyed random samples are repeatable and independent of call order', () => {
  const first = new DeterministicRandom('industrial-district:v1');
  const second = new DeterministicRandom('industrial-district:v1');

  const pedestrian = first.unit('pedestrian-wander', 'civilian-4:91');
  first.unit('traffic-route', 'traffic-2:18');

  assert.equal(second.unit('pedestrian-wander', 'civilian-4:91'), pedestrian);
  assert.notEqual(second.unit('pedestrian-wander', 'civilian-5:91'), pedestrian);
  assert.equal(first.integer('spawn', 7, 3, 9), second.integer('spawn', 7, 3, 9));
});

test('spatial index updates memberships and returns stable filtered queries', () => {
  type Kind = 'player' | 'npc' | 'vehicle';
  const index = new SpatialIndex<Kind>(64);
  const records: SpatialRecord<Kind>[] = [
    {id: 'player-b', kind: 'player', x: 10, y: 10, radius: 10},
    {id: 'player-a', kind: 'player', x: 14, y: 10, radius: 10},
    {id: 'car', kind: 'vehicle', x: 54, y: 10, radius: 20},
    {id: 'ped', kind: 'npc', x: 150, y: 10, radius: 10}
  ];
  index.rebuild(records);

  assert.equal(index.size, 4);
  assert.deepEqual(
    index.queryCircle(0, 0, 80, {kinds: ['player']}).map((record) => record.id),
    ['player-a', 'player-b']
  );
  assert.deepEqual(
    index.queryAabb(30, 0, 40, 20, {kinds: ['vehicle']}).map((record) => record.id),
    ['car']
  );

  index.upsert({id: 'car', kind: 'vehicle', x: 220, y: 10, radius: 20});
  assert.deepEqual(index.queryCircle(0, 0, 80, {kinds: ['vehicle']}), []);
  assert.equal(index.remove('npc', 'ped'), true);
  assert.equal(index.remove('npc', 'ped'), false);
  assert.equal(index.size, 3);
});

test('deferred commands deduplicate mutations and defer nested work to the next flush', () => {
  const queue = new DeferredCommandQueue();
  const applied: string[] = [];

  assert.equal(queue.defer('bullet:1', () => {
    applied.push('first');
    queue.defer('bullet:2', () => applied.push('nested'));
  }), true);
  assert.equal(queue.defer('bullet:1', () => applied.push('duplicate')), false);

  assert.equal(queue.flush(), 1);
  assert.deepEqual(applied, ['first']);
  assert.equal(queue.size, 1);
  assert.equal(queue.flush(), 1);
  assert.deepEqual(applied, ['first', 'nested']);
});

test('game event stream preserves typed event order and drains atomically', () => {
  const events = new GameEventStream(2);
  events.publish({
    type: 'crime.committed',
    tick: 4,
    nowMs: 120,
    suspectId: 'driver',
    heat: 1,
    resultingWantedLevel: 2
  });
  events.publish({
    type: 'player.respawned',
    tick: 5,
    nowMs: 150,
    playerId: 'driver',
    x: 40,
    y: 60
  });

  assert.equal(events.size, 2);
  assert.deepEqual(events.drain().map((event) => event.type), [
    'crime.committed',
    'player.respawned'
  ]);
  assert.equal(events.size, 0);
});
