export type MissionEntityKind = 'vehicle' | 'npc' | 'object';
export type MissionEntityDisposition = 'release' | 'despawn';

export interface MissionEntityRecord {
  missionId: string;
  kind: MissionEntityKind;
  entityId: string;
  disposition: MissionEntityDisposition;
}

export class MissionEntityScope {
  private readonly records = new Map<string, Map<string, MissionEntityRecord>>();

  constructor(private readonly capacityPerMission = 64) {
    if (!Number.isInteger(capacityPerMission) || capacityPerMission <= 0) {
      throw new RangeError('Mission entity capacity must be a positive integer.');
    }
  }

  track(record: MissionEntityRecord): boolean {
    let scope = this.records.get(record.missionId);
    if (!scope) {
      scope = new Map();
      this.records.set(record.missionId, scope);
    }
    const key = `${record.kind}:${record.entityId}`;
    if (scope.has(key)) return false;
    if (scope.size >= this.capacityPerMission) {
      throw new Error(`Mission ${record.missionId} exceeded its entity scope capacity.`);
    }
    scope.set(key, {...record});
    return true;
  }

  untrack(missionId: string, kind: MissionEntityKind, entityId: string): boolean {
    const scope = this.records.get(missionId);
    if (!scope) return false;
    const removed = scope.delete(`${kind}:${entityId}`);
    if (scope.size === 0) this.records.delete(missionId);
    return removed;
  }

  drain(missionId: string): MissionEntityRecord[] {
    const scope = this.records.get(missionId);
    if (!scope) return [];
    this.records.delete(missionId);
    return [...scope.values()].sort((left, right) => (
      left.kind.localeCompare(right.kind) || left.entityId.localeCompare(right.entityId)
    ));
  }

  clear(): void {
    this.records.clear();
  }
}
