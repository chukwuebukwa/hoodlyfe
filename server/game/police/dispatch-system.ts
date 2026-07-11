export interface DispatchSuspect {
  id: string;
  wantedLevel: number;
}

export interface DispatchChange {
  officerId: string;
  previousSuspectId: string;
  suspectId: string;
}

export class DispatchSystem {
  private readonly assignments = new Map<string, string>();

  update(suspects: readonly DispatchSuspect[], officerIds: readonly string[]): DispatchChange[] {
    const changes: DispatchChange[] = [];
    const eligible = [...suspects]
      .filter((suspect) => suspect.wantedLevel > 0)
      .sort((left, right) => right.wantedLevel - left.wantedLevel || left.id.localeCompare(right.id));
    const officerSet = new Set(officerIds);
    const eligibleById = new Map(eligible.map((suspect) => [suspect.id, suspect]));

    for (const [officerId, suspectId] of this.assignments) {
      if (officerSet.has(officerId) && eligibleById.has(suspectId)) continue;
      this.assignments.delete(officerId);
      changes.push({officerId, previousSuspectId: suspectId, suspectId: ''});
    }

    const assignedCounts = new Map<string, number>();
    for (const [officerId, suspectId] of [...this.assignments.entries()].sort()) {
      const suspect = eligibleById.get(suspectId);
      const retained = assignedCounts.get(suspectId) ?? 0;
      if (!suspect || retained >= responseLimit(suspect.wantedLevel)) {
        this.assignments.delete(officerId);
        changes.push({officerId, previousSuspectId: suspectId, suspectId: ''});
        continue;
      }
      assignedCounts.set(suspectId, retained + 1);
    }

    for (const officerId of [...officerIds].sort()) {
      if (this.assignments.has(officerId)) continue;
      const target = eligible.find((suspect) => (
        (assignedCounts.get(suspect.id) ?? 0) < responseLimit(suspect.wantedLevel)
      ));
      if (!target) break;
      this.assignments.set(officerId, target.id);
      assignedCounts.set(target.id, (assignedCounts.get(target.id) ?? 0) + 1);
      changes.push({officerId, previousSuspectId: '', suspectId: target.id});
    }
    return changes;
  }

  targetFor(officerId: string): string | undefined {
    return this.assignments.get(officerId);
  }

  entries(): Array<{officerId: string; suspectId: string}> {
    return [...this.assignments.entries()]
      .map(([officerId, suspectId]) => ({officerId, suspectId}))
      .sort((left, right) => left.officerId.localeCompare(right.officerId));
  }

  clearSuspect(suspectId: string): void {
    for (const [officerId, assignedSuspectId] of this.assignments) {
      if (assignedSuspectId === suspectId) this.assignments.delete(officerId);
    }
  }

  clear(): void {
    this.assignments.clear();
  }
}

function responseLimit(wantedLevel: number): number {
  return Math.max(1, Math.min(5, Math.floor(wantedLevel)));
}
