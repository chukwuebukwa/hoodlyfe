import type {
  PoliceResponseAssignment,
  PoliceResponseUnitKind
} from './police-response-allocation-system.ts';
import type {PursuitMode} from './pursuit-memory.ts';

export type PoliceTacticalRole =
  | 'primary'
  | 'contain-left'
  | 'contain-right'
  | 'support-left'
  | 'support-right'
  | 'intercept-left'
  | 'intercept-right';

export type PoliceTacticalPhase =
  | 'observe'
  | 'search'
  | 'pursue'
  | 'intercept'
  | 'contain'
  | 'arrest'
  | 'disengage';

export interface PoliceTactic {
  unitId: string;
  unitKind: PoliceResponseUnitKind;
  suspectId: string;
  role: PoliceTacticalRole;
  phase: PoliceTacticalPhase;
  goalX: number;
  goalY: number;
}

export interface PoliceTacticTarget {
  x: number;
  y: number;
  angle: number;
  inVehicle: boolean;
}

const FOOT_ROLES: readonly PoliceTacticalRole[] = Object.freeze([
  'primary',
  'contain-left',
  'contain-right',
  'support-left',
  'support-right'
]);
const VEHICLE_ROLES: readonly PoliceTacticalRole[] = Object.freeze([
  'primary',
  'intercept-left',
  'intercept-right'
]);

/**
 * Projects stable response leases into tactical roles. It does not allocate units,
 * perceive suspects, move actors, or decide gameplay outcomes.
 */
export class PursuitCoordinator {
  private readonly tactics = new Map<string, PoliceTactic>();

  update(assignments: readonly PoliceResponseAssignment[]): void {
    const next = new Map<string, PoliceTactic>();
    const groups = new Map<string, PoliceResponseAssignment[]>();
    for (const assignment of assignments) {
      const key = groupKey(assignment.suspectId, assignment.unitKind);
      const group = groups.get(key) ?? [];
      group.push(assignment);
      groups.set(key, group);
    }
    for (const group of [...groups.values()].sort(compareAssignmentGroups)) {
      const roles = rolesFor(group[0].unitKind).slice(0, group.length);
      const assignmentsById = new Map(group.map((assignment) => [assignment.unitId, assignment]));
      const roleAssignments = new Map<PoliceTacticalRole, PoliceResponseAssignment>();
      const retainedUnitIds = new Set<string>();
      for (const role of roles) {
        const previous = [...this.tactics.values()].find((tactic) => (
          tactic.suspectId === group[0].suspectId &&
          tactic.unitKind === group[0].unitKind &&
          tactic.role === role &&
          assignmentsById.has(tactic.unitId)
        ));
        if (!previous) continue;
        roleAssignments.set(role, assignmentsById.get(previous.unitId)!);
        retainedUnitIds.add(previous.unitId);
      }
      const unassigned = group
        .filter((assignment) => !retainedUnitIds.has(assignment.unitId))
        .sort(compareRolePriority);
      for (const role of roles) {
        if (roleAssignments.has(role)) continue;
        const assignment = unassigned.shift();
        if (assignment) roleAssignments.set(role, assignment);
      }
      for (const role of roles) {
        const assignment = roleAssignments.get(role);
        if (!assignment) continue;
        const key = unitKey(assignment.unitKind, assignment.unitId);
        const previous = this.tactics.get(key);
        next.set(key, previous &&
          previous.suspectId === assignment.suspectId &&
          previous.role === role
          ? {...previous}
          : {
            unitId: assignment.unitId,
            unitKind: assignment.unitKind,
            suspectId: assignment.suspectId,
            role,
            phase: 'observe',
            goalX: 0,
            goalY: 0
          });
      }
    }
    this.tactics.clear();
    for (const [key, tactic] of next) this.tactics.set(key, tactic);
  }

  roleFor(unitKind: PoliceResponseUnitKind, unitId: string): PoliceTacticalRole {
    return this.tactics.get(unitKey(unitKind, unitId))?.role ?? 'primary';
  }

  resolve(
    unitKind: PoliceResponseUnitKind,
    unitId: string,
    pursuitMode: PursuitMode,
    canSeeTarget: boolean,
    target: PoliceTacticTarget
  ): PoliceTactic {
    const key = unitKey(unitKind, unitId);
    const current = this.tactics.get(key) ?? {
      unitId,
      unitKind,
      suspectId: '',
      role: 'primary' as const,
      phase: 'observe' as const,
      goalX: target.x,
      goalY: target.y
    };
    const role = current.role;
    const phase = tacticalPhase(unitKind, role, pursuitMode, canSeeTarget, target.inVehicle);
    const goal = pursuitMode === 'search' || !canSeeTarget
      ? {x: target.x, y: target.y}
      : tacticalGoal(role, target);
    const tactic = {...current, phase, goalX: goal.x, goalY: goal.y};
    this.tactics.set(key, tactic);
    return {...tactic};
  }

  record(
    unitKind: PoliceResponseUnitKind,
    unitId: string,
    phase: PoliceTacticalPhase,
    goalX: number,
    goalY: number
  ): void {
    const key = unitKey(unitKind, unitId);
    const current = this.tactics.get(key);
    if (!current) return;
    current.phase = phase;
    current.goalX = goalX;
    current.goalY = goalY;
  }

  clearSuspect(suspectId: string): void {
    for (const [key, tactic] of this.tactics) {
      if (tactic.suspectId === suspectId) this.tactics.delete(key);
    }
  }

  diagnostics(): PoliceTactic[] {
    return [...this.tactics.values()]
      .map((tactic) => ({...tactic}))
      .sort((left, right) => (
        left.suspectId.localeCompare(right.suspectId) ||
        left.unitKind.localeCompare(right.unitKind) ||
        left.unitId.localeCompare(right.unitId)
      ));
  }
}

export function tacticalGoal(
  role: PoliceTacticalRole,
  target: PoliceTacticTarget
): {x: number; y: number} {
  if (role === 'primary') return {x: target.x, y: target.y};
  const forwardX = Math.cos(target.angle);
  const forwardY = Math.sin(target.angle);
  const leftX = -forwardY;
  const leftY = forwardX;
  switch (role) {
    case 'contain-left':
      return {x: target.x + leftX * 105, y: target.y + leftY * 105};
    case 'contain-right':
      return {x: target.x - leftX * 105, y: target.y - leftY * 105};
    case 'support-left':
      return {
        x: target.x - forwardX * 115 + leftX * 145,
        y: target.y - forwardY * 115 + leftY * 145
      };
    case 'support-right':
      return {
        x: target.x - forwardX * 115 - leftX * 145,
        y: target.y - forwardY * 115 - leftY * 145
      };
    case 'intercept-left':
      return {
        x: target.x + forwardX * 110 + leftX * 78,
        y: target.y + forwardY * 110 + leftY * 78
      };
    case 'intercept-right':
      return {
        x: target.x + forwardX * 110 - leftX * 78,
        y: target.y + forwardY * 110 - leftY * 78
      };
  }
}

function tacticalPhase(
  unitKind: PoliceResponseUnitKind,
  role: PoliceTacticalRole,
  pursuitMode: PursuitMode,
  canSeeTarget: boolean,
  targetInVehicle: boolean
): PoliceTacticalPhase {
  if (pursuitMode === 'search' || !canSeeTarget) return 'search';
  if (role === 'primary') return unitKind === 'vehicle' && targetInVehicle
    ? 'intercept'
    : 'pursue';
  if (role === 'intercept-left' || role === 'intercept-right') {
    return targetInVehicle ? 'intercept' : 'contain';
  }
  return 'contain';
}

function rolesFor(unitKind: PoliceResponseUnitKind): readonly PoliceTacticalRole[] {
  return unitKind === 'foot' ? FOOT_ROLES : VEHICLE_ROLES;
}

function compareRolePriority(
  left: PoliceResponseAssignment,
  right: PoliceResponseAssignment
): number {
  return left.assignedAt - right.assignedAt ||
    left.distance - right.distance ||
    left.unitId.localeCompare(right.unitId);
}

function compareAssignmentGroups(
  left: readonly PoliceResponseAssignment[],
  right: readonly PoliceResponseAssignment[]
): number {
  const leftFirst = left[0];
  const rightFirst = right[0];
  return leftFirst.suspectId.localeCompare(rightFirst.suspectId) ||
    leftFirst.unitKind.localeCompare(rightFirst.unitKind);
}

function groupKey(suspectId: string, unitKind: PoliceResponseUnitKind): string {
  return `${suspectId}\u0000${unitKind}`;
}

function unitKey(unitKind: PoliceResponseUnitKind, unitId: string): string {
  return `${unitKind}\u0000${unitId}`;
}
