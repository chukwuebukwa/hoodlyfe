export type PoliceResponseUnitKind = 'foot' | 'vehicle';

export interface PoliceResponseSuspect {
  id: string;
  wantedLevel: number;
  reportAt: number;
  reportedX: number;
  reportedY: number;
  currentX: number;
  currentY: number;
}

export interface PoliceResponseUnit {
  id: string;
  kind: PoliceResponseUnitKind;
  x: number;
  y: number;
  available: boolean;
}

export type PoliceResponseChangeReason =
  | 'assigned'
  | 'budget'
  | 'replaced'
  | 'search-expired'
  | 'suspect-cleared'
  | 'unavailable';

export interface PoliceResponseChange {
  unitId: string;
  unitKind: PoliceResponseUnitKind;
  previousSuspectId: string;
  suspectId: string;
  reason: PoliceResponseChangeReason;
}

export interface PoliceResponseAssignment {
  unitId: string;
  unitKind: PoliceResponseUnitKind;
  suspectId: string;
  reportAt: number;
  assignedAt: number;
  distance: number;
}

export interface PoliceResponseDemandDiagnostic {
  suspectId: string;
  wantedLevel: number;
  desiredFoot: number;
  assignedFoot: number;
  desiredVehicles: number;
  assignedVehicles: number;
}

export interface PoliceResponseAllocationDiagnostic {
  maxResponsePoints: number;
  usedResponsePoints: number;
  maxFootUnits: number;
  maxVehicleUnits: number;
  assignedFootUnits: number;
  assignedVehicleUnits: number;
  suppressedPairs: number;
  demands: PoliceResponseDemandDiagnostic[];
  assignments: PoliceResponseAssignment[];
  lastChanges: PoliceResponseChange[];
}

export interface PoliceResponseFleetTarget {
  suspectId: string;
  wantedLevel: number;
  x: number;
  y: number;
  desiredUnits: number;
  assignedUnits: number;
}

export interface PoliceResponseFleetPlan {
  desiredUnits: number;
  targets: PoliceResponseFleetTarget[];
}

export interface PoliceResponseLimits {
  foot: number;
  vehicle: number;
}

type ResponseLimits = PoliceResponseLimits;

interface MutableAssignment extends PoliceResponseAssignment {}

interface SuppressedPair {
  reportAt: number;
}

export interface PoliceResponseAllocationOptions {
  maxResponsePoints: number;
  maxFootUnits: number;
  maxVehicleUnits: number;
  footWeight: number;
  vehicleWeight: number;
  minimumLeaseMs: number;
  replacementAdvantage: number;
  reassignmentCooldownMs: number;
}

const UNIT_KINDS = ['foot', 'vehicle'] as const;
type AllocationPolicy = PoliceResponseAllocationOptions;

const DEFAULT_POLICY: AllocationPolicy = Object.freeze({
  maxResponsePoints: 11,
  maxFootUnits: 5,
  maxVehicleUnits: 3,
  footWeight: 1,
  vehicleWeight: 2,
  minimumLeaseMs: 1_500,
  replacementAdvantage: 180,
  reassignmentCooldownMs: 1_200
});

/**
 * Owns finite district response leases. It reads authoritative poses for scoring but does
 * not move actors, run AI, or participate in client prediction/replay.
 */
export class PoliceResponseAllocationSystem {
  private readonly assignments = new Map<string, MutableAssignment>();
  private readonly suppressions = new Map<string, SuppressedPair>();
  private readonly cooldownUntil = new Map<string, number>();
  private readonly policy: AllocationPolicy;
  private suspects: PoliceResponseSuspect[] = [];
  private desiredQuotas = emptyQuotas();
  private lastChanges: PoliceResponseChange[] = [];
  private readonly pendingChanges: PoliceResponseChange[] = [];
  private collectingUpdateChanges = false;

  constructor(options: Partial<PoliceResponseAllocationOptions> = {}) {
    this.policy = validatePolicy({...DEFAULT_POLICY, ...options});
  }

  update(
    suspects: readonly PoliceResponseSuspect[],
    units: readonly PoliceResponseUnit[],
    nowMs: number
  ): PoliceResponseChange[] {
    assertFinite(nowMs, 'Response allocation time');
    const normalizedSuspects = normalizeSuspects(suspects);
    const normalizedUnits = normalizeUnits(units);
    this.lastChanges = this.pendingChanges.splice(0);
    const updateChangeStart = this.lastChanges.length;
    this.collectingUpdateChanges = true;
    try {
      this.suspects = normalizedSuspects;
      const suspectById = new Map(this.suspects.map((suspect) => [suspect.id, suspect]));
      const unitByKey = new Map(normalizedUnits.map((unit) => [unitKey(unit.kind, unit.id), unit]));
      this.cleanupTransientState(suspectById, unitByKey, nowMs);

      for (const assignment of [...this.assignments.values()].sort(compareAssignments)) {
        const key = unitKey(assignment.unitKind, assignment.unitId);
        const unit = unitByKey.get(key);
        const suspect = suspectById.get(assignment.suspectId);
        if (!unit?.available) {
          this.releaseAssignment(key, 'unavailable', nowMs);
        } else if (!suspect) {
          this.releaseAssignment(key, 'suspect-cleared', nowMs);
        } else if (this.isSuppressed(unit, suspect)) {
          this.releaseAssignment(key, 'search-expired', nowMs);
        } else {
          assignment.reportAt = suspect.reportAt;
          assignment.distance = distanceToSuspect(unit, suspect);
        }
      }

      this.desiredQuotas = computeQuotas(this.suspects, {
        foot: this.policy.maxFootUnits,
        vehicle: this.policy.maxVehicleUnits
      }, this.policy);
      const availableCounts = countAvailableUnits(normalizedUnits);
      const assignmentQuotas = computeQuotas(this.suspects, {
        foot: Math.min(this.policy.maxFootUnits, availableCounts.foot),
        vehicle: Math.min(this.policy.maxVehicleUnits, availableCounts.vehicle)
      }, this.policy);

      this.releaseQuotaSurplus(assignmentQuotas, suspectById, unitByKey, nowMs);
      this.fillQuotaDeficits(assignmentQuotas, suspectById, normalizedUnits, nowMs);
      this.replaceDistantAssignments(suspectById, normalizedUnits, nowMs);
      this.swapPoorAssignments(suspectById, unitByKey, nowMs);
      this.refreshDistances(suspectById, unitByKey);
      return this.lastChanges.slice(updateChangeStart).map((change) => ({...change}));
    } finally {
      this.collectingUpdateChanges = false;
    }
  }

  assignmentFor(
    unitKind: PoliceResponseUnitKind,
    unitId: string
  ): PoliceResponseAssignment | undefined {
    const assignment = this.assignments.get(unitKey(unitKind, unitId));
    return assignment ? {...assignment} : undefined;
  }

  entries(): PoliceResponseAssignment[] {
    return [...this.assignments.values()]
      .map((assignment) => ({...assignment}))
      .sort(compareAssignments);
  }

  suppressReport(
    unitKind: PoliceResponseUnitKind,
    unitId: string,
    suspectId: string,
    reportAt: number,
    nowMs: number
  ): PoliceResponseChange | undefined {
    assertFinite(reportAt, 'Suppressed report time');
    assertFinite(nowMs, 'Suppression time');
    const key = unitKey(unitKind, unitId);
    const pairKey = suppressionKey(unitKind, unitId, suspectId);
    const previous = this.suppressions.get(pairKey);
    this.suppressions.set(pairKey, {reportAt: Math.max(reportAt, previous?.reportAt ?? -1)});
    const assignment = this.assignments.get(key);
    if (!assignment || assignment.suspectId !== suspectId) return undefined;
    return this.releaseAssignment(key, 'search-expired', nowMs);
  }

  releaseUnit(
    unitKind: PoliceResponseUnitKind,
    unitId: string,
    nowMs: number
  ): PoliceResponseChange | undefined {
    assertFinite(nowMs, 'Unit release time');
    return this.releaseAssignment(unitKey(unitKind, unitId), 'unavailable', nowMs);
  }

  clearSuspect(suspectId: string, nowMs: number): PoliceResponseChange[] {
    assertFinite(nowMs, 'Suspect clear time');
    const changes: PoliceResponseChange[] = [];
    for (const [key, assignment] of [...this.assignments.entries()].sort()) {
      if (assignment.suspectId !== suspectId) continue;
      const change = this.releaseAssignment(key, 'suspect-cleared', nowMs);
      if (change) changes.push(change);
    }
    for (const key of this.suppressions.keys()) {
      if (key.endsWith(`\u0000${suspectId}`)) this.suppressions.delete(key);
    }
    this.suspects = this.suspects.filter((suspect) => suspect.id !== suspectId);
    return changes;
  }

  fleetPlan(): PoliceResponseFleetPlan {
    const assigned = this.assignmentCounts();
    const targets = this.suspects.map((suspect) => {
      const desired = this.desiredQuotas.get(suspect.id) ?? ZERO_LIMITS;
      const current = assigned.get(suspect.id) ?? ZERO_LIMITS;
      return {
        suspectId: suspect.id,
        wantedLevel: suspect.wantedLevel,
        x: suspect.currentX,
        y: suspect.currentY,
        desiredUnits: desired.vehicle,
        assignedUnits: current.vehicle
      };
    }).filter((target) => target.desiredUnits > 0).sort((left, right) => (
      (right.desiredUnits - right.assignedUnits) - (left.desiredUnits - left.assignedUnits) ||
      right.wantedLevel - left.wantedLevel ||
      left.suspectId.localeCompare(right.suspectId)
    ));
    return {
      desiredUnits: Math.min(
        this.policy.maxVehicleUnits,
        targets.reduce((total, target) => total + target.desiredUnits, 0)
      ),
      targets
    };
  }

  diagnostics(): PoliceResponseAllocationDiagnostic {
    const assignments = this.entries();
    const assigned = this.assignmentCounts();
    const demands = this.suspects.map((suspect) => {
      const desired = this.desiredQuotas.get(suspect.id) ?? ZERO_LIMITS;
      const current = assigned.get(suspect.id) ?? ZERO_LIMITS;
      return {
        suspectId: suspect.id,
        wantedLevel: suspect.wantedLevel,
        desiredFoot: desired.foot,
        assignedFoot: current.foot,
        desiredVehicles: desired.vehicle,
        assignedVehicles: current.vehicle
      };
    });
    const assignedFootUnits = assignments.filter((entry) => entry.unitKind === 'foot').length;
    const assignedVehicleUnits = assignments.length - assignedFootUnits;
    return {
      maxResponsePoints: this.policy.maxResponsePoints,
      usedResponsePoints: assignedFootUnits * this.policy.footWeight +
        assignedVehicleUnits * this.policy.vehicleWeight,
      maxFootUnits: this.policy.maxFootUnits,
      maxVehicleUnits: this.policy.maxVehicleUnits,
      assignedFootUnits,
      assignedVehicleUnits,
      suppressedPairs: this.suppressions.size,
      demands,
      assignments,
      lastChanges: this.lastChanges.map((change) => ({...change}))
    };
  }

  private cleanupTransientState(
    suspectById: ReadonlyMap<string, PoliceResponseSuspect>,
    unitByKey: ReadonlyMap<string, PoliceResponseUnit>,
    nowMs: number
  ): void {
    for (const [key, until] of this.cooldownUntil) {
      if (until <= nowMs || !unitByKey.has(key)) this.cooldownUntil.delete(key);
    }
    for (const [key, suppression] of this.suppressions) {
      const [unitKind, unitId, suspectId] = splitSuppressionKey(key);
      const suspect = suspectById.get(suspectId);
      if (
        !unitByKey.has(unitKey(unitKind, unitId)) ||
        !suspect ||
        suspect.reportAt > suppression.reportAt
      ) {
        this.suppressions.delete(key);
      }
    }
  }

  private releaseQuotaSurplus(
    quotas: ReadonlyMap<string, ResponseLimits>,
    suspectById: ReadonlyMap<string, PoliceResponseSuspect>,
    unitByKey: ReadonlyMap<string, PoliceResponseUnit>,
    nowMs: number
  ): void {
    for (const suspect of this.suspects) {
      const quota = quotas.get(suspect.id) ?? ZERO_LIMITS;
      const hardLimit = responseLimitsForWanted(suspect.wantedLevel);
      for (const kind of UNIT_KINDS) {
        const assigned = [...this.assignments.entries()]
          .filter(([, entry]) => entry.suspectId === suspect.id && entry.unitKind === kind)
          .sort((left, right) => {
            const leftUnit = unitByKey.get(left[0]);
            const rightUnit = unitByKey.get(right[0]);
            const leftDistance = leftUnit ? distanceToSuspect(leftUnit, suspect) : Infinity;
            const rightDistance = rightUnit ? distanceToSuspect(rightUnit, suspect) : Infinity;
            return rightDistance - leftDistance ||
              right[1].assignedAt - left[1].assignedAt ||
              left[0].localeCompare(right[0]);
          });
        let excess = Math.max(0, assigned.length - quota[kind]);
        const hardExcess = Math.max(0, assigned.length - hardLimit[kind]);
        for (let index = 0; index < assigned.length && excess > 0; index++) {
          const [key, assignment] = assigned[index];
          const mustRelease = index < hardExcess;
          if (!mustRelease && nowMs - assignment.assignedAt < this.policy.minimumLeaseMs) continue;
          this.releaseAssignment(key, 'budget', nowMs);
          excess--;
        }
      }
    }
    this.refreshDistances(suspectById, unitByKey);
  }

  private fillQuotaDeficits(
    quotas: ReadonlyMap<string, ResponseLimits>,
    suspectById: ReadonlyMap<string, PoliceResponseSuspect>,
    units: readonly PoliceResponseUnit[],
    nowMs: number
  ): void {
    for (;;) {
      const counts = this.assignmentCounts();
      const target = this.suspects.map((suspect) => {
        const quota = quotas.get(suspect.id) ?? ZERO_LIMITS;
        const assigned = counts.get(suspect.id) ?? ZERO_LIMITS;
        const kinds = UNIT_KINDS.filter((kind) => assigned[kind] < quota[kind]);
        return {suspect, quota, assigned, kinds};
      }).filter((candidate) => candidate.kinds.length > 0).sort((left, right) => {
        const leftCoverage = responseCoverage(left.assigned, left.quota, this.policy);
        const rightCoverage = responseCoverage(right.assigned, right.quota, this.policy);
        return leftCoverage - rightCoverage ||
          right.suspect.wantedLevel - left.suspect.wantedLevel ||
          left.suspect.id.localeCompare(right.suspect.id);
      })[0];
      if (!target) return;
      const kind = [...target.kinds].sort((left, right) => {
        const leftCoverage = target.assigned[left] / Math.max(1, target.quota[left]);
        const rightCoverage = target.assigned[right] / Math.max(1, target.quota[right]);
        return leftCoverage - rightCoverage || left.localeCompare(right);
      })[0];
      const unit = units.filter((candidate) => (
        candidate.available &&
        candidate.kind === kind &&
        !this.assignments.has(unitKey(candidate.kind, candidate.id)) &&
        (this.cooldownUntil.get(unitKey(candidate.kind, candidate.id)) ?? 0) <= nowMs &&
        !this.isSuppressed(candidate, target.suspect)
      )).sort((left, right) => (
        distanceToSuspect(left, target.suspect) - distanceToSuspect(right, target.suspect) ||
        left.id.localeCompare(right.id)
      ))[0];
      if (!unit) return;
      this.assign(unit, target.suspect, nowMs, 'assigned');
      if (!suspectById.has(target.suspect.id)) return;
    }
  }

  private replaceDistantAssignments(
    suspectById: ReadonlyMap<string, PoliceResponseSuspect>,
    units: readonly PoliceResponseUnit[],
    nowMs: number
  ): void {
    const freeUnits = units.filter((unit) => (
      unit.available &&
      !this.assignments.has(unitKey(unit.kind, unit.id)) &&
      (this.cooldownUntil.get(unitKey(unit.kind, unit.id)) ?? 0) <= nowMs
    )).sort(compareUnits);
    for (const candidate of freeUnits) {
      let replacement: {key: string; assignment: MutableAssignment; improvement: number} | undefined;
      for (const [key, assignment] of this.assignments) {
        if (
          assignment.unitKind !== candidate.kind ||
          nowMs - assignment.assignedAt < this.policy.minimumLeaseMs ||
          (this.cooldownUntil.get(key) ?? 0) > nowMs
        ) continue;
        const suspect = suspectById.get(assignment.suspectId);
        if (!suspect || this.isSuppressed(candidate, suspect)) continue;
        const improvement = assignment.distance - distanceToSuspect(candidate, suspect);
        if (improvement < this.policy.replacementAdvantage) continue;
        if (!replacement || improvement > replacement.improvement || (
          improvement === replacement.improvement && key.localeCompare(replacement.key) < 0
        )) {
          replacement = {key, assignment, improvement};
        }
      }
      if (!replacement) continue;
      const suspect = suspectById.get(replacement.assignment.suspectId);
      if (!suspect) continue;
      this.releaseAssignment(replacement.key, 'replaced', nowMs);
      this.assign(candidate, suspect, nowMs, 'replaced');
    }
  }

  private swapPoorAssignments(
    suspectById: ReadonlyMap<string, PoliceResponseSuspect>,
    unitByKey: ReadonlyMap<string, PoliceResponseUnit>,
    nowMs: number
  ): void {
    const entries = [...this.assignments.entries()].sort((left, right) => left[0].localeCompare(right[0]));
    const swapped = new Set<string>();
    for (let leftIndex = 0; leftIndex < entries.length; leftIndex++) {
      const [leftKey, left] = entries[leftIndex];
      if (swapped.has(leftKey) || nowMs - left.assignedAt < this.policy.minimumLeaseMs) continue;
      const leftUnit = unitByKey.get(leftKey);
      const leftSuspect = suspectById.get(left.suspectId);
      if (!leftUnit || !leftSuspect) continue;
      for (let rightIndex = leftIndex + 1; rightIndex < entries.length; rightIndex++) {
        const [rightKey, right] = entries[rightIndex];
        if (
          swapped.has(rightKey) ||
          left.unitKind !== right.unitKind ||
          left.suspectId === right.suspectId ||
          nowMs - right.assignedAt < this.policy.minimumLeaseMs ||
          (this.cooldownUntil.get(leftKey) ?? 0) > nowMs ||
          (this.cooldownUntil.get(rightKey) ?? 0) > nowMs
        ) continue;
        const rightUnit = unitByKey.get(rightKey);
        const rightSuspect = suspectById.get(right.suspectId);
        if (
          !rightUnit || !rightSuspect ||
          this.isSuppressed(leftUnit, rightSuspect) ||
          this.isSuppressed(rightUnit, leftSuspect)
        ) continue;
        const currentDistance = distanceToSuspect(leftUnit, leftSuspect) +
          distanceToSuspect(rightUnit, rightSuspect);
        const swappedDistance = distanceToSuspect(leftUnit, rightSuspect) +
          distanceToSuspect(rightUnit, leftSuspect);
        if (currentDistance - swappedDistance < this.policy.replacementAdvantage * 2) continue;

        const previousLeftSuspect = left.suspectId;
        const previousRightSuspect = right.suspectId;
        left.suspectId = previousRightSuspect;
        left.reportAt = rightSuspect.reportAt;
        left.assignedAt = nowMs;
        right.suspectId = previousLeftSuspect;
        right.reportAt = leftSuspect.reportAt;
        right.assignedAt = nowMs;
        this.cooldownUntil.set(leftKey, nowMs + this.policy.reassignmentCooldownMs);
        this.cooldownUntil.set(rightKey, nowMs + this.policy.reassignmentCooldownMs);
        this.recordChange({
          unitId: left.unitId,
          unitKind: left.unitKind,
          previousSuspectId: previousLeftSuspect,
          suspectId: left.suspectId,
          reason: 'replaced'
        });
        this.recordChange({
          unitId: right.unitId,
          unitKind: right.unitKind,
          previousSuspectId: previousRightSuspect,
          suspectId: right.suspectId,
          reason: 'replaced'
        });
        swapped.add(leftKey);
        swapped.add(rightKey);
        break;
      }
    }
  }

  private refreshDistances(
    suspectById: ReadonlyMap<string, PoliceResponseSuspect>,
    unitByKey: ReadonlyMap<string, PoliceResponseUnit>
  ): void {
    for (const [key, assignment] of this.assignments) {
      const unit = unitByKey.get(key);
      const suspect = suspectById.get(assignment.suspectId);
      if (unit && suspect) assignment.distance = distanceToSuspect(unit, suspect);
    }
  }

  private assign(
    unit: PoliceResponseUnit,
    suspect: PoliceResponseSuspect,
    nowMs: number,
    reason: Extract<PoliceResponseChangeReason, 'assigned' | 'replaced'>
  ): PoliceResponseChange {
    const assignment: MutableAssignment = {
      unitId: unit.id,
      unitKind: unit.kind,
      suspectId: suspect.id,
      reportAt: suspect.reportAt,
      assignedAt: nowMs,
      distance: distanceToSuspect(unit, suspect)
    };
    this.assignments.set(unitKey(unit.kind, unit.id), assignment);
    const change: PoliceResponseChange = {
      unitId: unit.id,
      unitKind: unit.kind,
      previousSuspectId: '',
      suspectId: suspect.id,
      reason
    };
    this.recordChange(change);
    return change;
  }

  private releaseAssignment(
    key: string,
    reason: Exclude<PoliceResponseChangeReason, 'assigned'>,
    nowMs: number
  ): PoliceResponseChange | undefined {
    const assignment = this.assignments.get(key);
    if (!assignment) return undefined;
    this.assignments.delete(key);
    this.cooldownUntil.set(key, nowMs + this.policy.reassignmentCooldownMs);
    const change: PoliceResponseChange = {
      unitId: assignment.unitId,
      unitKind: assignment.unitKind,
      previousSuspectId: assignment.suspectId,
      suspectId: '',
      reason
    };
    this.recordChange(change);
    return change;
  }

  private isSuppressed(unit: PoliceResponseUnit, suspect: PoliceResponseSuspect): boolean {
    const suppression = this.suppressions.get(suppressionKey(unit.kind, unit.id, suspect.id));
    return Boolean(suppression && suspect.reportAt <= suppression.reportAt);
  }

  private assignmentCounts(): Map<string, ResponseLimits> {
    const counts = new Map<string, ResponseLimits>();
    for (const assignment of this.assignments.values()) {
      const current = counts.get(assignment.suspectId) ?? {foot: 0, vehicle: 0};
      current[assignment.unitKind]++;
      counts.set(assignment.suspectId, current);
    }
    return counts;
  }

  private recordChange(change: PoliceResponseChange): void {
    this.lastChanges.push({...change});
    if (!this.collectingUpdateChanges) this.pendingChanges.push({...change});
    if (this.lastChanges.length > 24) this.lastChanges.splice(0, this.lastChanges.length - 24);
    if (this.pendingChanges.length > 24) {
      this.pendingChanges.splice(0, this.pendingChanges.length - 24);
    }
  }
}

export function responseLimitsForWanted(wantedLevel: number): ResponseLimits {
  const level = Math.max(0, Math.floor(wantedLevel));
  if (level <= 0) return {foot: 0, vehicle: 0};
  if (level === 1) return {foot: 1, vehicle: 1};
  if (level === 2) return {foot: 3, vehicle: 2};
  if (level === 3) return {foot: 4, vehicle: 2};
  if (level === 4) return {foot: 5, vehicle: 2};
  return {foot: 5, vehicle: 3};
}

function computeQuotas(
  suspects: readonly PoliceResponseSuspect[],
  capacities: ResponseLimits,
  policy: AllocationPolicy
): Map<string, ResponseLimits> {
  const quotas = emptyQuotas(suspects);
  let usedFoot = 0;
  let usedVehicles = 0;
  let usedPoints = 0;
  for (;;) {
    const candidates = suspects.map((suspect) => {
      const limits = responseLimitsForWanted(suspect.wantedLevel);
      const quota = quotas.get(suspect.id)!;
      const kinds = UNIT_KINDS.filter((kind) => {
        const kindUsed = kind === 'foot' ? usedFoot : usedVehicles;
        const kindCapacity = capacities[kind];
        const weight = unitWeight(kind, policy);
        return quota[kind] < limits[kind] &&
          kindUsed < kindCapacity &&
          usedPoints + weight <= policy.maxResponsePoints;
      });
      return {suspect, limits, quota, kinds};
    }).filter((candidate) => candidate.kinds.length > 0).sort((left, right) => {
      const leftCoverage = responseCoverage(left.quota, left.limits, policy);
      const rightCoverage = responseCoverage(right.quota, right.limits, policy);
      return leftCoverage - rightCoverage ||
        right.suspect.wantedLevel - left.suspect.wantedLevel ||
        left.suspect.id.localeCompare(right.suspect.id);
    });
    const candidate = candidates[0];
    if (!candidate) return quotas;
    const kind = [...candidate.kinds].sort((left, right) => {
      const leftCoverage = candidate.quota[left] / Math.max(1, candidate.limits[left]);
      const rightCoverage = candidate.quota[right] / Math.max(1, candidate.limits[right]);
      return leftCoverage - rightCoverage || left.localeCompare(right);
    })[0];
    candidate.quota[kind]++;
    if (kind === 'foot') usedFoot++;
    else usedVehicles++;
    usedPoints += unitWeight(kind, policy);
  }
}

function responseCoverage(
  assigned: ResponseLimits,
  limits: ResponseLimits,
  policy: AllocationPolicy
): number {
  const desiredPoints = limits.foot * policy.footWeight + limits.vehicle * policy.vehicleWeight;
  if (desiredPoints <= 0) return 1;
  return (assigned.foot * policy.footWeight + assigned.vehicle * policy.vehicleWeight) /
    desiredPoints;
}

function normalizeSuspects(suspects: readonly PoliceResponseSuspect[]): PoliceResponseSuspect[] {
  const byId = new Map<string, PoliceResponseSuspect>();
  for (const suspect of suspects) {
    if (!suspect.id.trim() || suspect.wantedLevel <= 0) continue;
    for (const [value, name] of [
      [suspect.wantedLevel, 'wanted level'],
      [suspect.reportAt, 'report time'],
      [suspect.reportedX, 'reported X'],
      [suspect.reportedY, 'reported Y'],
      [suspect.currentX, 'current X'],
      [suspect.currentY, 'current Y']
    ] as const) assertFinite(value, `Suspect ${suspect.id} ${name}`);
    const current = byId.get(suspect.id);
    if (!current || suspect.reportAt > current.reportAt) byId.set(suspect.id, {...suspect});
  }
  return [...byId.values()].sort((left, right) => (
    right.wantedLevel - left.wantedLevel || left.id.localeCompare(right.id)
  ));
}

function normalizeUnits(units: readonly PoliceResponseUnit[]): PoliceResponseUnit[] {
  const byKey = new Map<string, PoliceResponseUnit>();
  for (const unit of units) {
    if (!unit.id.trim()) continue;
    assertFinite(unit.x, `Response unit ${unit.id} X`);
    assertFinite(unit.y, `Response unit ${unit.id} Y`);
    byKey.set(unitKey(unit.kind, unit.id), {...unit});
  }
  return [...byKey.values()].sort(compareUnits);
}

function countAvailableUnits(units: readonly PoliceResponseUnit[]): ResponseLimits {
  const counts = {foot: 0, vehicle: 0};
  for (const unit of units) {
    if (unit.available) counts[unit.kind]++;
  }
  return counts;
}

function emptyQuotas(
  suspects: readonly PoliceResponseSuspect[] = []
): Map<string, ResponseLimits> {
  return new Map(suspects.map((suspect) => [suspect.id, {foot: 0, vehicle: 0}]));
}

function distanceToSuspect(unit: PoliceResponseUnit, suspect: PoliceResponseSuspect): number {
  return Math.hypot(unit.x - suspect.currentX, unit.y - suspect.currentY);
}

function compareAssignments(left: PoliceResponseAssignment, right: PoliceResponseAssignment): number {
  return left.unitKind.localeCompare(right.unitKind) || left.unitId.localeCompare(right.unitId);
}

function compareUnits(left: PoliceResponseUnit, right: PoliceResponseUnit): number {
  return left.kind.localeCompare(right.kind) || left.id.localeCompare(right.id);
}

function unitWeight(kind: PoliceResponseUnitKind, policy: AllocationPolicy): number {
  return kind === 'foot' ? policy.footWeight : policy.vehicleWeight;
}

function unitKey(kind: PoliceResponseUnitKind, unitId: string): string {
  return `${kind}\u0000${unitId}`;
}

function suppressionKey(
  kind: PoliceResponseUnitKind,
  unitId: string,
  suspectId: string
): string {
  return `${kind}\u0000${unitId}\u0000${suspectId}`;
}

function splitSuppressionKey(
  key: string
): [PoliceResponseUnitKind, string, string] {
  const [kind, unitId, suspectId] = key.split('\u0000');
  return [kind as PoliceResponseUnitKind, unitId, suspectId];
}

function validatePolicy(policy: AllocationPolicy): AllocationPolicy {
  for (const [value, name] of [
    [policy.maxResponsePoints, 'Maximum response points'],
    [policy.maxFootUnits, 'Maximum foot units'],
    [policy.maxVehicleUnits, 'Maximum vehicle units'],
    [policy.footWeight, 'Foot-unit weight'],
    [policy.vehicleWeight, 'Vehicle-unit weight'],
    [policy.minimumLeaseMs, 'Minimum response lease'],
    [policy.replacementAdvantage, 'Replacement advantage'],
    [policy.reassignmentCooldownMs, 'Reassignment cooldown']
  ] as const) {
    if (!Number.isFinite(value) || value < 0) throw new RangeError(`${name} must be non-negative.`);
  }
  if (policy.footWeight === 0 || policy.vehicleWeight === 0) {
    throw new RangeError('Response unit weights must be positive.');
  }
  return Object.freeze({...policy});
}

function assertFinite(value: number, name: string): void {
  if (!Number.isFinite(value)) throw new RangeError(`${name} must be finite.`);
}

const ZERO_LIMITS: Readonly<ResponseLimits> = Object.freeze({foot: 0, vehicle: 0});
