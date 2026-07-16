export type TrafficJunctionPhase = 'none' | 'waiting' | 'approach' | 'crossing' | 'clearing';

export interface TrafficJunctionDiagnostic {
  junctionId: string;
  phase: TrafficJunctionPhase;
  queuePosition: number;
  leaseExpiresAt: number;
}

interface JunctionWaiter {
  vehicleId: string;
  arrivedAt: number;
}

interface JunctionReservation {
  vehicleId: string;
  expiresAt: number;
  phase: Exclude<TrafficJunctionPhase, 'none' | 'waiting'>;
  exitX: number;
  exitY: number;
}

const NONE: TrafficJunctionDiagnostic = Object.freeze({
  junctionId: '',
  phase: 'none',
  queuePosition: 0,
  leaseExpiresAt: 0
});

export class TrafficJunctionSystem {
  private readonly reservations = new Map<string, JunctionReservation>();
  private readonly waiters = new Map<string, Map<string, JunctionWaiter>>();
  private readonly junctionByVehicle = new Map<string, string>();

  constructor(private readonly reservationMs = 3_000) {}

  request(vehicleId: string, junctionId: string, nowMs: number, blocked = false): boolean {
    this.releaseDifferentJunction(vehicleId, junctionId);
    this.expire(junctionId, nowMs);
    const queue = this.queue(junctionId);
    if (!queue.has(vehicleId)) queue.set(vehicleId, {vehicleId, arrivedAt: nowMs});
    this.junctionByVehicle.set(vehicleId, junctionId);

    const current = this.reservations.get(junctionId);
    if (current?.vehicleId === vehicleId) {
      if (current.phase === 'approach' && blocked) {
        this.reservations.delete(junctionId);
        return false;
      }
      current.expiresAt = nowMs + this.reservationMs;
      return true;
    }
    if (current || blocked || this.ordered(queue)[0]?.vehicleId !== vehicleId) return false;

    this.reservations.set(junctionId, {
      vehicleId,
      expiresAt: nowMs + this.reservationMs,
      phase: 'approach',
      exitX: 0,
      exitY: 0
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
      const reservation = this.reservations.get(key);
      if (reservation?.vehicleId === vehicleId) this.reservations.delete(key);
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

  diagnostic(vehicleId: string): TrafficJunctionDiagnostic {
    const junctionId = this.junctionByVehicle.get(vehicleId);
    if (!junctionId) return NONE;
    const queue = this.ordered(this.waiters.get(junctionId));
    const reservation = this.reservations.get(junctionId);
    return {
      junctionId,
      phase: reservation?.vehicleId === vehicleId ? reservation.phase : 'waiting',
      queuePosition: Math.max(0, queue.findIndex((entry) => entry.vehicleId === vehicleId) + 1),
      leaseExpiresAt: reservation?.vehicleId === vehicleId ? reservation.expiresAt : 0
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

  private ordered(queue?: Map<string, JunctionWaiter>): JunctionWaiter[] {
    return [...(queue?.values() ?? [])].sort((left, right) => (
      left.arrivedAt - right.arrivedAt || left.vehicleId.localeCompare(right.vehicleId)
    ));
  }

  private ownedReservation(
    vehicleId: string,
    junctionId: string,
    nowMs: number
  ): JunctionReservation | undefined {
    this.expire(junctionId, nowMs);
    const reservation = this.reservations.get(junctionId);
    return reservation?.vehicleId === vehicleId ? reservation : undefined;
  }

  private expire(junctionId: string, nowMs: number): void {
    const reservation = this.reservations.get(junctionId);
    if (!reservation || nowMs < reservation.expiresAt) return;
    this.reservations.delete(junctionId);
    this.waiters.get(junctionId)?.delete(reservation.vehicleId);
    if (this.junctionByVehicle.get(reservation.vehicleId) === junctionId) {
      this.junctionByVehicle.delete(reservation.vehicleId);
    }
  }

  private releaseDifferentJunction(vehicleId: string, junctionId: string): void {
    const current = this.junctionByVehicle.get(vehicleId);
    if (current && current !== junctionId) this.release(vehicleId, current);
  }
}
