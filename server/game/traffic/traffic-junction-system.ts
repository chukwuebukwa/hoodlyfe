import {
  exclusiveJunctionMovement,
  junctionMovementsConflict,
  type TrafficJunctionMovement,
  type TrafficJunctionMovementPoint
} from './traffic-junction-conflict-policy.ts';

export type TrafficJunctionPhase = 'none' | 'waiting' | 'approach' | 'crossing' | 'clearing';

export interface TrafficJunctionDiagnostic {
  junctionId: string;
  phase: TrafficJunctionPhase;
  queuePosition: number;
  leaseExpiresAt: number;
  movementId: string;
  movementTurn: TrafficJunctionMovement['turn'];
  movementPath: readonly TrafficJunctionMovementPoint[];
  activeOwnerCount: number;
  conflictingOwnerCount: number;
}

interface JunctionWaiter {
  vehicleId: string;
  arrivedAt: number;
  blocked: boolean;
  movement: TrafficJunctionMovement;
}

interface JunctionReservation {
  vehicleId: string;
  expiresAt: number;
  phase: Exclude<TrafficJunctionPhase, 'none' | 'waiting'>;
  exitX: number;
  exitY: number;
  movement: TrafficJunctionMovement;
}

const NONE: TrafficJunctionDiagnostic = Object.freeze({
  junctionId: '',
  phase: 'none',
  queuePosition: 0,
  leaseExpiresAt: 0,
  movementId: '',
  movementTurn: 'straight',
  movementPath: Object.freeze([]),
  activeOwnerCount: 0,
  conflictingOwnerCount: 0
});

export class TrafficJunctionSystem {
  private readonly reservations = new Map<string, Map<string, JunctionReservation>>();
  private readonly waiters = new Map<string, Map<string, JunctionWaiter>>();
  private readonly junctionByVehicle = new Map<string, string>();

  constructor(
    private readonly reservationMs = 3_000,
    private readonly maximumOwners = 4
  ) {}

  request(
    vehicleId: string,
    junctionId: string,
    nowMs: number,
    blocked = false,
    movement = exclusiveJunctionMovement(junctionId)
  ): boolean {
    this.releaseDifferentJunction(vehicleId, junctionId);
    this.expire(junctionId, nowMs);
    const safeMovement = movement.junctionId === junctionId
      ? movement
      : exclusiveJunctionMovement(junctionId);
    const queue = this.queue(junctionId);
    const waiter = queue.get(vehicleId) ?? {
      vehicleId,
      arrivedAt: nowMs,
      blocked,
      movement: safeMovement
    };
    waiter.blocked = blocked;
    waiter.movement = safeMovement;
    queue.set(vehicleId, waiter);
    this.junctionByVehicle.set(vehicleId, junctionId);

    const owners = this.ownerMap(junctionId);
    const current = owners.get(vehicleId);
    if (current) {
      if (current.phase === 'approach' && blocked) {
        owners.delete(vehicleId);
        this.removeEmptyOwners(junctionId);
        return false;
      }
      current.expiresAt = nowMs + this.reservationMs;
      return true;
    }
    if (
      blocked ||
      owners.size >= this.maximumOwners ||
      this.conflictingOwners(safeMovement, owners).length > 0 ||
      this.hasEarlierConflictingWaiter(waiter, queue, owners)
    ) {
      return false;
    }

    owners.set(vehicleId, {
      vehicleId,
      expiresAt: nowMs + this.reservationMs,
      phase: 'approach',
      exitX: 0,
      exitY: 0,
      movement: safeMovement
    });
    return true;
  }

  markCrossing(vehicleId: string, junctionId: string, nowMs: number): boolean {
    const reservation = this.ownedReservation(vehicleId, junctionId, nowMs);
    if (!reservation) return false;
    reservation.phase = 'crossing';
    reservation.expiresAt = nowMs + this.reservationMs;
    return true;
  }

  markClearing(
    vehicleId: string,
    junctionId: string,
    exitX: number,
    exitY: number,
    nowMs: number
  ): boolean {
    const reservation = this.ownedReservation(vehicleId, junctionId, nowMs);
    if (!reservation) return false;
    reservation.phase = 'clearing';
    reservation.exitX = exitX;
    reservation.exitY = exitY;
    reservation.expiresAt = nowMs + this.reservationMs;
    return true;
  }

  maintain(
    vehicleId: string,
    x: number,
    y: number,
    clearanceDistance: number,
    nowMs: number
  ): boolean {
    const junctionId = this.junctionByVehicle.get(vehicleId);
    if (!junctionId) return false;
    const reservation = this.ownedReservation(vehicleId, junctionId, nowMs);
    if (!reservation) return false;
    if (
      reservation.phase === 'clearing' &&
      Math.hypot(x - reservation.exitX, y - reservation.exitY) >= clearanceDistance
    ) {
      this.release(vehicleId, junctionId);
      return false;
    }
    reservation.expiresAt = nowMs + this.reservationMs;
    return true;
  }

  release(vehicleId: string, junctionId?: string): void {
    const keys = junctionId
      ? [junctionId]
      : [...new Set([
        ...this.waiters.keys(),
        ...this.reservations.keys(),
        ...(this.junctionByVehicle.get(vehicleId) ? [this.junctionByVehicle.get(vehicleId)!] : [])
      ])];
    for (const key of keys) {
      const owners = this.reservations.get(key);
      owners?.delete(vehicleId);
      this.removeEmptyOwners(key);
      const queue = this.waiters.get(key);
      queue?.delete(vehicleId);
      if (queue?.size === 0) this.waiters.delete(key);
    }
    if (!junctionId || this.junctionByVehicle.get(vehicleId) === junctionId) {
      this.junctionByVehicle.delete(vehicleId);
    }
  }

  waiting(junctionId: string): string[] {
    return this.ordered(this.waiters.get(junctionId)).map((entry) => entry.vehicleId);
  }

  isQueued(vehicleId: string, junctionId: string): boolean {
    return this.waiters.get(junctionId)?.has(vehicleId) ?? false;
  }

  compatibleOwnerIds(vehicleId: string, junctionId: string): Set<string> {
    const owners = this.reservations.get(junctionId);
    const owner = owners?.get(vehicleId);
    if (!owners || !owner) return new Set();
    return new Set([...owners.values()]
      .filter((candidate) => (
        candidate.vehicleId !== vehicleId &&
        !junctionMovementsConflict(owner.movement, candidate.movement)
      ))
      .map((candidate) => candidate.vehicleId));
  }

  activeOwners(junctionId: string): string[] {
    return [...(this.reservations.get(junctionId)?.keys() ?? [])].sort();
  }

  diagnostic(vehicleId: string): TrafficJunctionDiagnostic {
    const junctionId = this.junctionByVehicle.get(vehicleId);
    if (!junctionId) return NONE;
    const queue = this.ordered(this.waiters.get(junctionId));
    const owners = this.reservations.get(junctionId);
    const reservation = owners?.get(vehicleId);
    const movement = reservation?.movement ??
      this.waiters.get(junctionId)?.get(vehicleId)?.movement ??
      exclusiveJunctionMovement(junctionId);
    return {
      junctionId,
      phase: reservation ? reservation.phase : 'waiting',
      queuePosition: Math.max(0, queue.findIndex((entry) => entry.vehicleId === vehicleId) + 1),
      leaseExpiresAt: reservation?.expiresAt ?? 0,
      movementId: movement.id,
      movementTurn: movement.turn,
      movementPath: movement.path.map((point) => ({...point})),
      activeOwnerCount: owners?.size ?? 0,
      conflictingOwnerCount: this.conflictingOwners(movement, owners, vehicleId).length
    };
  }

  private queue(junctionId: string): Map<string, JunctionWaiter> {
    let queue = this.waiters.get(junctionId);
    if (!queue) {
      queue = new Map();
      this.waiters.set(junctionId, queue);
    }
    return queue;
  }

  private ownerMap(junctionId: string): Map<string, JunctionReservation> {
    let owners = this.reservations.get(junctionId);
    if (!owners) {
      owners = new Map();
      this.reservations.set(junctionId, owners);
    }
    return owners;
  }

  private ordered(queue?: Map<string, JunctionWaiter>): JunctionWaiter[] {
    return [...(queue?.values() ?? [])].sort((left, right) => (
      left.arrivedAt - right.arrivedAt || left.vehicleId.localeCompare(right.vehicleId)
    ));
  }

  private hasEarlierConflictingWaiter(
    candidate: JunctionWaiter,
    queue: Map<string, JunctionWaiter>,
    owners: Map<string, JunctionReservation>
  ): boolean {
    for (const waiter of this.ordered(queue)) {
      if (waiter.vehicleId === candidate.vehicleId) return false;
      if (owners.has(waiter.vehicleId)) continue;
      if (
        waiter.blocked &&
        !candidate.movement.exclusive &&
        !waiter.movement.exclusive
      ) {
        continue;
      }
      if (junctionMovementsConflict(candidate.movement, waiter.movement)) return true;
    }
    return false;
  }

  private conflictingOwners(
    movement: TrafficJunctionMovement,
    owners?: Map<string, JunctionReservation>,
    exceptVehicleId = ''
  ): JunctionReservation[] {
    return [...(owners?.values() ?? [])].filter((owner) => (
      owner.vehicleId !== exceptVehicleId &&
      junctionMovementsConflict(movement, owner.movement)
    ));
  }

  private ownedReservation(
    vehicleId: string,
    junctionId: string,
    nowMs: number
  ): JunctionReservation | undefined {
    this.expire(junctionId, nowMs);
    return this.reservations.get(junctionId)?.get(vehicleId);
  }

  private expire(junctionId: string, nowMs: number): void {
    const owners = this.reservations.get(junctionId);
    if (!owners) return;
    for (const reservation of [...owners.values()]) {
      if (nowMs < reservation.expiresAt) continue;
      owners.delete(reservation.vehicleId);
      this.waiters.get(junctionId)?.delete(reservation.vehicleId);
      if (this.junctionByVehicle.get(reservation.vehicleId) === junctionId) {
        this.junctionByVehicle.delete(reservation.vehicleId);
      }
    }
    this.removeEmptyOwners(junctionId);
    if (this.waiters.get(junctionId)?.size === 0) this.waiters.delete(junctionId);
  }

  private removeEmptyOwners(junctionId: string): void {
    if (this.reservations.get(junctionId)?.size === 0) this.reservations.delete(junctionId);
  }

  private releaseDifferentJunction(vehicleId: string, junctionId: string): void {
    const current = this.junctionByVehicle.get(vehicleId);
    if (current && current !== junctionId) this.release(vehicleId, current);
  }
}
