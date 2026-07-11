interface JunctionWaiter {
  vehicleId: string;
  arrivedAt: number;
}

interface JunctionReservation {
  vehicleId: string;
  expiresAt: number;
}

export class TrafficJunctionSystem {
  private readonly reservations = new Map<string, JunctionReservation>();
  private readonly waiters = new Map<string, Map<string, JunctionWaiter>>();

  constructor(private readonly reservationMs = 3_000) {}

  request(vehicleId: string, junctionKey: string, nowMs: number): boolean {
    this.expire(junctionKey, nowMs);
    let queue = this.waiters.get(junctionKey);
    if (!queue) {
      queue = new Map();
      this.waiters.set(junctionKey, queue);
    }
    if (!queue.has(vehicleId)) queue.set(vehicleId, {vehicleId, arrivedAt: nowMs});

    const current = this.reservations.get(junctionKey);
    if (current?.vehicleId === vehicleId) return true;
    if (current) return false;

    const first = [...queue.values()].sort((left, right) => (
      left.arrivedAt - right.arrivedAt || left.vehicleId.localeCompare(right.vehicleId)
    ))[0];
    if (first?.vehicleId !== vehicleId) return false;
    this.reservations.set(junctionKey, {
      vehicleId,
      expiresAt: nowMs + this.reservationMs
    });
    return true;
  }

  release(vehicleId: string, junctionKey?: string): void {
    const keys = junctionKey ? [junctionKey] : [...this.waiters.keys()];
    for (const key of keys) {
      const reservation = this.reservations.get(key);
      if (reservation?.vehicleId === vehicleId) this.reservations.delete(key);
      const queue = this.waiters.get(key);
      queue?.delete(vehicleId);
      if (queue?.size === 0) this.waiters.delete(key);
    }
  }

  waiting(junctionKey: string): string[] {
    return [...(this.waiters.get(junctionKey)?.values() ?? [])]
      .sort((left, right) => left.arrivedAt - right.arrivedAt || left.vehicleId.localeCompare(right.vehicleId))
      .map((entry) => entry.vehicleId);
  }

  private expire(junctionKey: string, nowMs: number): void {
    const reservation = this.reservations.get(junctionKey);
    if (reservation && nowMs >= reservation.expiresAt) {
      this.reservations.delete(junctionKey);
      this.waiters.get(junctionKey)?.delete(reservation.vehicleId);
    }
  }
}
