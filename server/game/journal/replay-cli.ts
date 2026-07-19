import {readFileSync} from 'node:fs';
import {parseJournal} from './journal-sink.ts';
import {replayJournal} from './journal-replay.ts';

const filePath = process.argv[2];
if (!filePath) {
  console.error('Usage: tsx server/game/journal/replay-cli.ts <journal.jsonl>');
  process.exit(2);
}

const journal = parseJournal(readFileSync(filePath, 'utf8'));
console.log(
  `Replaying journal: seed=${journal.header.seed} epoch=${journal.header.epochMs} ` +
  `records=${journal.records.length} collisionRevision=${journal.header.collisionRevision}`
);
const result = await replayJournal(journal);
console.log(`Ticks run: ${result.ticksRun}. Hashes checked: ${result.hashesChecked}.`);
if (result.divergences.length > 0) {
  console.error('State divergences detected:');
  for (const divergence of result.divergences) {
    console.error(
      `  tick ${divergence.tick}: expected ${divergence.expected}, got ${divergence.actual}`
    );
  }
  process.exit(1);
}
console.log('Replay matched the recorded state hashes.');
process.exit(0);
