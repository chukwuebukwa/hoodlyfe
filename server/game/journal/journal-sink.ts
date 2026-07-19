import {createWriteStream, mkdirSync, type WriteStream} from 'node:fs';
import {dirname} from 'node:path';
import {
  JOURNAL_FORMAT_VERSION,
  type JournalHeader,
  type JournalRecord,
  type RecordedJournal
} from './journal-types.ts';

export interface JournalSink {
  begin(header: JournalHeader): void;
  append(record: JournalRecord): void;
  close(): void;
}

export class MemoryJournalSink implements JournalSink {
  private storedHeader?: JournalHeader;
  private readonly storedRecords: JournalRecord[] = [];

  begin(header: JournalHeader): void {
    this.storedHeader = deepClone(header);
  }

  append(record: JournalRecord): void {
    this.storedRecords.push(deepClone(record));
  }

  close(): void {}

  journal(): RecordedJournal {
    if (!this.storedHeader) throw new Error('Journal sink never received a header.');
    return {header: this.storedHeader, records: [...this.storedRecords]};
  }
}

export class FileJournalSink implements JournalSink {
  private readonly stream: WriteStream;

  constructor(readonly filePath: string) {
    mkdirSync(dirname(filePath), {recursive: true});
    this.stream = createWriteStream(filePath, {flags: 'w'});
  }

  begin(header: JournalHeader): void {
    this.stream.write(`${JSON.stringify(header)}\n`);
  }

  append(record: JournalRecord): void {
    this.stream.write(`${JSON.stringify(record)}\n`);
  }

  close(): void {
    this.stream.end();
  }
}

export function parseJournal(text: string): RecordedJournal {
  const lines = text.split('\n').filter((line) => line.trim().length > 0);
  if (lines.length === 0) throw new Error('Journal text is empty.');
  const header = JSON.parse(lines[0]) as JournalHeader;
  if (header.kind !== 'header') throw new Error('Journal must begin with a header line.');
  if (header.version !== JOURNAL_FORMAT_VERSION) {
    throw new Error(`Unsupported journal version ${header.version}.`);
  }
  const records = lines.slice(1).map((line, index) => {
    const record = JSON.parse(line) as JournalRecord;
    if (!record.kind || !Number.isInteger(record.tick)) {
      throw new Error(`Malformed journal record at line ${index + 2}.`);
    }
    return record;
  });
  return {header, records};
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
