const WANTED_THRESHOLDS = [0, 10, 25, 45, 70, 100] as const;

interface WantedRecord {
  heat: number;
  level: number;
  lastCrimeAt: number;
  lastReportAt: number;
  lastDecayAt: number;
}
export interface WantedState {
  heat: number;
  level: number;
}

export class WantedSystem {
  private readonly records = new Map<string, WantedRecord>();

  constructor(
    private readonly decayDelayMs = 10_000,
    private readonly decayStepMs = 6500,
    private readonly decayAmount = 12
  ) {}

  noteCrime(suspectId: string, nowMs: number): void {
    const record = this.getOrCreate(suspectId);
    record.lastCrimeAt = nowMs;
  }

  report(suspectId: string, severity: number, nowMs: number): WantedState {
    const record = this.getOrCreate(suspectId);
    record.heat = Math.min(120, record.heat + Math.max(0, severity));
    record.level = levelForHeat(record.heat);
    record.lastCrimeAt = Math.max(record.lastCrimeAt, nowMs);
    record.lastReportAt = nowMs;
    record.lastDecayAt = nowMs;
    return {heat: record.heat, level: record.level};
  }

  tryDecay(suspectId: string, nowMs: number, policeNearby: boolean): WantedState {
    const record = this.getOrCreate(suspectId);
    if (
      record.level === 0 ||
      policeNearby ||
      nowMs - record.lastCrimeAt < this.decayDelayMs ||
      nowMs - record.lastDecayAt < this.decayStepMs
    ) {
      return {heat: record.heat, level: record.level};
    }
    record.heat = Math.max(0, record.heat - this.decayAmount);
    record.level = levelForHeat(record.heat);
    record.lastDecayAt = nowMs;
    return {heat: record.heat, level: record.level};
  }

  get(suspectId: string): WantedState {
    const record = this.records.get(suspectId);
    return record ? {heat: record.heat, level: record.level} : {heat: 0, level: 0};
  }

  reset(suspectId: string): void {
    this.records.delete(suspectId);
  }

  clear(): void {
    this.records.clear();
  }

  private getOrCreate(suspectId: string): WantedRecord {
    let record = this.records.get(suspectId);
    if (!record) {
      record = {
        heat: 0,
        level: 0,
        lastCrimeAt: Number.NEGATIVE_INFINITY,
        lastReportAt: Number.NEGATIVE_INFINITY,
        lastDecayAt: Number.NEGATIVE_INFINITY
      };
      this.records.set(suspectId, record);
    }
    return record;
  }
}

function levelForHeat(heat: number): number {
  let level = 0;
  for (let index = 1; index < WANTED_THRESHOLDS.length; index++) {
    if (heat < WANTED_THRESHOLDS[index]) break;
    level = index;
  }
  return level;
}
