export type PursuitMode = 'pursuit' | 'search';

export interface PursuitRecord {
  officerId: string;
  suspectId: string;
  lastKnownX: number;
  lastKnownY: number;
  lastSeenAt: number;
  searchUntil: number;
  mode: PursuitMode;
}

export class PursuitMemory {
  private readonly records = new Map<string, PursuitRecord>();

  constructor(private readonly searchDurationMs = 8000) {}

  assignSearch(officerId: string, suspectId: string, x: number, y: number, nowMs: number): PursuitRecord {
    const record: PursuitRecord = {
      officerId,
      suspectId,
      lastKnownX: x,
      lastKnownY: y,
      lastSeenAt: nowMs,
      searchUntil: nowMs + this.searchDurationMs,
      mode: 'search'
    };
    this.records.set(officerId, record);
    return {...record};
  }

  observe(officerId: string, suspectId: string, x: number, y: number, nowMs: number): PursuitRecord {
    const record: PursuitRecord = {
      officerId,
      suspectId,
      lastKnownX: x,
      lastKnownY: y,
      lastSeenAt: nowMs,
      searchUntil: nowMs + this.searchDurationMs,
      mode: 'pursuit'
    };
    this.records.set(officerId, record);
    return {...record};
  }

  search(officerId: string, suspectId: string, nowMs: number): PursuitRecord | undefined {
    const record = this.records.get(officerId);
    if (!record || record.suspectId !== suspectId || nowMs > record.searchUntil) {
      this.records.delete(officerId);
      return undefined;
    }
    record.mode = 'search';
    return {...record};
  }

  get(officerId: string): PursuitRecord | undefined {
    const record = this.records.get(officerId);
    return record ? {...record} : undefined;
  }

  clearOfficer(officerId: string): void {
    this.records.delete(officerId);
  }

  clearSuspect(suspectId: string): void {
    for (const [officerId, record] of this.records) {
      if (record.suspectId === suspectId) this.records.delete(officerId);
    }
  }

  entries(): PursuitRecord[] {
    return [...this.records.values()]
      .map((record) => ({...record}))
      .sort((left, right) => left.officerId.localeCompare(right.officerId));
  }

  clear(): void {
    this.records.clear();
  }
}
