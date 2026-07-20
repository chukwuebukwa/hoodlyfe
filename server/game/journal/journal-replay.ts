import {DistrictRoom} from '../../district-room.ts';
import {hashDistrictState} from './state-hash.ts';
import type {RecordedJournal} from './journal-types.ts';

export interface ReplayDivergence {
  tick: number;
  expected: number;
  actual: number;
}

export interface ReplayResult {
  ticksRun: number;
  hashesChecked: number;
  divergences: ReplayDivergence[];
}

// Rebuilds the district headlessly from a recorded journal: same seed and epoch,
// journaled spawns/leaves/commands applied at their recorded tick boundaries, and
// recorded state hashes compared after each hashed tick completes.
export async function replayJournal(journal: RecordedJournal): Promise<ReplayResult> {
  const {header, records} = journal;
  const room = new DistrictRoom();
  try {
    await room.onCreate({
      seed: header.seed,
      epochMs: header.epochMs,
      externalSimulation: true
    });
    let ticksRun = 0;
    let hashesChecked = 0;
    const divergences: ReplayDivergence[] = [];
    const advanceTo = (tick: number): void => {
      while (room.simulationTick < tick) {
        room.stepSimulationTick();
        ticksRun++;
      }
    };
    for (const record of records) {
      advanceTo(record.tick);
      switch (record.kind) {
        case 'spawn':
          room.applyJournaledSpawn(record.sessionId, {
            name: record.name,
            appearance: record.appearance
          });
          break;
        case 'leave':
          room.applyJournaledLeave(record.sessionId);
          break;
        case 'command':
          room.applyJournaledCommand(record.sessionId, record.type, record.payload);
          break;
        case 'events':
          break;
        case 'hash': {
          hashesChecked++;
          const actual = hashDistrictState(room.state);
          if (actual !== record.value) {
            divergences.push({tick: record.tick, expected: record.value, actual});
          }
          break;
        }
      }
    }
    return {ticksRun, hashesChecked, divergences};
  } finally {
    room.onDispose();
    room.clock.clear();
  }
}
