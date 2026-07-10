import {CRIME_POLICIES, type CrimeKind} from './crime-policy.ts';

export type IncidentStatus = 'unreported' | 'scheduled' | 'reported';

export interface Incident {
  id: string;
  kind: CrimeKind;
  suspectId: string;
  victimId: string;
  x: number;
  y: number;
  severity: number;
  createdAt: number;
  expiresAt: number;
  status: IncidentStatus;
  witnessId: string;
  reportAt: number;
  reportedAt: number;
}
export interface RegisterIncidentInput {
  kind: CrimeKind;
  suspectId: string;
  victimId?: string;
  x: number;
  y: number;
  nowMs: number;
}

export class IncidentRegistry {
  private readonly incidents = new Map<string, Incident>();
  private readonly recentDedupe = new Map<string, {incidentId: string; createdAt: number}>();
  private nextId = 1;

  constructor(private readonly capacity = 128) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new RangeError('Incident capacity must be a positive integer.');
    }
  }

  get size(): number {
    return this.incidents.size;
  }

  get activeCount(): number {
    let count = 0;
    for (const incident of this.incidents.values()) {
      if (incident.status !== 'reported') count++;
    }
    return count;
  }

  register(input: RegisterIncidentInput): {incident: Incident; created: boolean} {
    const policy = CRIME_POLICIES[input.kind];
    const dedupeKey = `${input.suspectId}:${input.kind}:${input.victimId ?? ''}`;
    const recent = this.recentDedupe.get(dedupeKey);
    if (recent && input.nowMs - recent.createdAt <= policy.dedupeMs) {
      const incident = this.incidents.get(recent.incidentId);
      if (incident) return {incident, created: false};
    }

    this.makeRoom();
    const incident: Incident = {
      id: `incident-${this.nextId++}`,
      kind: input.kind,
      suspectId: input.suspectId,
      victimId: input.victimId ?? '',
      x: input.x,
      y: input.y,
      severity: policy.severity,
      createdAt: input.nowMs,
      expiresAt: input.nowMs + policy.lifetimeMs,
      status: 'unreported',
      witnessId: '',
      reportAt: 0,
      reportedAt: 0
    };
    this.incidents.set(incident.id, incident);
    this.recentDedupe.set(dedupeKey, {incidentId: incident.id, createdAt: input.nowMs});
    return {incident, created: true};
  }

  scheduleReport(incidentId: string, witnessId: string, reportAt: number): boolean {
    const incident = this.incidents.get(incidentId);
    if (!incident || incident.status !== 'unreported') return false;
    incident.status = 'scheduled';
    incident.witnessId = witnessId;
    incident.reportAt = reportAt;
    return true;
  }

  dueReports(nowMs: number): Incident[] {
    return [...this.incidents.values()]
      .filter((incident) => (
        incident.status === 'scheduled' &&
        incident.reportAt <= nowMs &&
        incident.expiresAt > nowMs
      ))
      .sort((left, right) => left.reportAt - right.reportAt || left.id.localeCompare(right.id));
  }

  markReported(incidentId: string, nowMs: number): boolean {
    const incident = this.incidents.get(incidentId);
    if (!incident || incident.status === 'reported') return false;
    incident.status = 'reported';
    incident.reportedAt = nowMs;
    return true;
  }

  expire(nowMs: number): number {
    let removed = 0;
    for (const [id, incident] of this.incidents) {
      const retentionEndsAt = incident.status === 'reported'
        ? incident.reportedAt + 6000
        : incident.expiresAt;
      if (retentionEndsAt > nowMs) continue;
      this.incidents.delete(id);
      removed++;
    }
    this.cleanDedupe(nowMs);
    return removed;
  }

  clearSuspect(suspectId: string): void {
    for (const [id, incident] of this.incidents) {
      if (incident.suspectId === suspectId) this.incidents.delete(id);
    }
    for (const [key] of this.recentDedupe) {
      if (key.startsWith(`${suspectId}:`)) this.recentDedupe.delete(key);
    }
  }

  snapshot(): Incident[] {
    return [...this.incidents.values()].map((incident) => ({...incident}));
  }

  clear(): void {
    this.incidents.clear();
    this.recentDedupe.clear();
    this.nextId = 1;
  }

  private makeRoom(): void {
    if (this.incidents.size < this.capacity) return;
    const oldest = [...this.incidents.values()].sort((left, right) => {
      const leftPriority = left.status === 'reported' ? 0 : 1;
      const rightPriority = right.status === 'reported' ? 0 : 1;
      return leftPriority - rightPriority || left.createdAt - right.createdAt;
    })[0];
    if (oldest) this.incidents.delete(oldest.id);
  }

  private cleanDedupe(nowMs: number): void {
    for (const [key, recent] of this.recentDedupe) {
      if (!this.incidents.has(recent.incidentId) || nowMs - recent.createdAt > 30_000) {
        this.recentDedupe.delete(key);
      }
    }
  }
}
