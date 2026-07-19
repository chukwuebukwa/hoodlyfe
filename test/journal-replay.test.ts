import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import test from 'node:test';
import {DistrictRoom} from '../server/district-room.ts';
import {MemoryJournalSink} from '../server/game/journal/journal-sink.ts';
import {replayJournal} from '../server/game/journal/journal-replay.ts';
import {hashDistrictState} from '../server/game/journal/state-hash.ts';
import type {RecordedJournal} from '../server/game/journal/journal-types.ts';
import {ON_FOOT_INPUT_MESSAGE} from '../shared/protocol/on-foot-input.ts';

const hasLocalAssets = existsSync(resolve('public/assets/maps/district-map.json'));

interface RecordedSession {
  journal: RecordedJournal;
  finalHash: number;
  finalTick: number;
}

async function recordScriptedSession(): Promise<RecordedSession> {
  const sink = new MemoryJournalSink();
  const room = new DistrictRoom();
  try {
    await room.onCreate({
      seed: 1234,
      epochMs: 1_000_000,
      journalSink: sink,
      journalHashIntervalTicks: 15,
      externalSimulation: true
    });
    room.applyJournaledSpawn('session-a', {name: 'Recorder'});
    room.applyJournaledSpawn('session-b', {name: 'Bystander'});
    let sequence = 0;
    for (let tick = 1; tick <= 120; tick++) {
      if (tick >= 5 && tick <= 60) {
        sequence++;
        room.applyJournaledCommand('session-a', ON_FOOT_INPUT_MESSAGE, {
          moves: [{sequence, x: 1, y: tick % 20 < 10 ? 0 : 1}]
        });
      }
      if (tick === 20) {
        room.applyJournaledCommand('session-a', 'aim', {angle: Math.PI / 4});
      }
      if (tick === 25 || tick === 26) {
        room.applyJournaledCommand('session-a', 'shoot', undefined);
      }
      if (tick === 70) {
        room.applyJournaledCommand('session-a', 'cycleWeapon', {direction: 1});
      }
      if (tick === 90) {
        room.applyJournaledLeave('session-b');
      }
      room.stepSimulationTick();
    }
    return {
      journal: sink.journal(),
      finalHash: hashDistrictState(room.state),
      finalTick: room.simulationTick
    };
  } finally {
    room.onDispose();
    room.clock.clear();
  }
}

test('recorded district session replays with identical state hashes', {
  skip: !hasLocalAssets,
  timeout: 120_000
}, async () => {
  const session = await recordScriptedSession();
  const hashRecords = session.journal.records.filter((record) => record.kind === 'hash');
  assert.ok(hashRecords.length >= 8, 'expected periodic hash records');
  assert.ok(session.journal.records.some((record) => record.kind === 'events'),
    'expected game events in the journal');

  const result = await replayJournal(session.journal);
  assert.deepEqual(result.divergences, []);
  assert.equal(result.hashesChecked, hashRecords.length);
  assert.equal(result.ticksRun, session.finalTick);
});

test('replay detects a tampered journal hash', {
  skip: !hasLocalAssets,
  timeout: 120_000
}, async () => {
  const session = await recordScriptedSession();
  const hashRecord = session.journal.records.find((record) => record.kind === 'hash');
  assert.ok(hashRecord && hashRecord.kind === 'hash');
  hashRecord.value = (hashRecord.value ^ 0xdead) >>> 0;
  const result = await replayJournal(session.journal);
  assert.equal(result.divergences.length, 1);
  assert.equal(result.divergences[0].tick, hashRecord.tick);
});

test('two recordings of the same script produce identical journals', {
  skip: !hasLocalAssets,
  timeout: 120_000
}, async () => {
  const first = await recordScriptedSession();
  const second = await recordScriptedSession();
  assert.equal(first.finalHash, second.finalHash);
  assert.deepEqual(second.journal.records, first.journal.records);
});
