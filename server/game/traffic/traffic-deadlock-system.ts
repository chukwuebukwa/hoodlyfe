import type {TrafficJunctionPhase} from './traffic-junction-system.ts';

const OBSERVATION_MAX_AGE_MS = 250;
const DEADLOCK_CONFIRMATION_MS = 6_000;
const RECOVERY_DURATION_MS = 950;
const RECOVERY_COOLDOWN_MS = 8_000;
const STATIONARY_SPEED = 6;

export interface TrafficDeadlockObservation {
  vehicleId: string;
  obstacleId: string;
  speedReason: string;
  speed: number;
  junctionPhase: TrafficJunctionPhase;
  canReverse: boolean;
  observedAt: number;
}

export interface TrafficDeadlockCommand {
  cycleId: string;
  cycleSize: number;
  blockerId: string;
  expiresAt: number;
}

export interface TrafficDeadlockDiagnostic {
  cycleId: string;
  cycleSize: number;
  recovering: boolean;
  recoveryCount: number;
}

interface CycleTrack {
  firstSeenAt: number;
  lastSeenAt: number;
  cooldownUntil: number;
}

interface CycleMembership {
  cycleId: string;
  cycleSize: number;
}

const NONE: TrafficDeadlockDiagnostic = Object.freeze({
  cycleId: '',
  cycleSize: 0,
  recovering: false,
  recoveryCount: 0
});

/**
 * Detects persistent functional blocker cycles and authorizes one bounded recovery owner.
 * It never moves vehicles itself, so traffic policy remains separate from driving physics.
 */
export class TrafficDeadlockSystem {
  private readonly observations = new Map<string, TrafficDeadlockObservation>();
  private readonly tracks = new Map<string, CycleTrack>();
  private readonly memberships = new Map<string, CycleMembership>();
  private readonly commands = new Map<string, TrafficDeadlockCommand>();
  private readonly recoveryCounts = new Map<string, number>();

  observe(observation: TrafficDeadlockObservation): void {
    this.observations.set(observation.vehicleId, {...observation});
  }

  beginTick(nowMs: number): void {
    this.expire(nowMs);
    this.memberships.clear();
    const cycles = findBlockerCycles(this.currentBlockers(nowMs));
    const seen = new Set<string>();

    for (const vehicleIds of cycles) {
      const cycleId = vehicleIds.slice().sort().join('|');
      seen.add(cycleId);
      for (const vehicleId of vehicleIds) {
        this.memberships.set(vehicleId, {cycleId, cycleSize: vehicleIds.length});
      }
      const existing = this.tracks.get(cycleId);
      const track = existing ?? {
        firstSeenAt: nowMs,
        lastSeenAt: nowMs,
        cooldownUntil: 0
      };
      track.lastSeenAt = nowMs;
      this.tracks.set(cycleId, track);
      if (nowMs - track.firstSeenAt < DEADLOCK_CONFIRMATION_MS) continue;
      if (nowMs < track.cooldownUntil || this.hasActiveCommand(vehicleIds, nowMs)) continue;

      const owner = this.selectRecoveryOwner(vehicleIds);
      if (!owner) continue;
      this.commands.set(owner.vehicleId, {
        cycleId,
        cycleSize: vehicleIds.length,
        blockerId: owner.obstacleId,
        expiresAt: nowMs + RECOVERY_DURATION_MS
      });
      this.recoveryCounts.set(owner.vehicleId, (this.recoveryCounts.get(owner.vehicleId) ?? 0) + 1);
      track.cooldownUntil = nowMs + RECOVERY_COOLDOWN_MS;
      track.firstSeenAt = nowMs;
    }

    for (const [cycleId, track] of this.tracks) {
      if (!seen.has(cycleId) && nowMs - track.lastSeenAt > OBSERVATION_MAX_AGE_MS) {
        this.tracks.delete(cycleId);
      }
    }
  }

  command(vehicleId: string, nowMs: number): TrafficDeadlockCommand | undefined {
    const command = this.commands.get(vehicleId);
    if (!command || nowMs >= command.expiresAt) return undefined;
    return command;
  }

  diagnostic(vehicleId: string, nowMs = Number.NEGATIVE_INFINITY): TrafficDeadlockDiagnostic {
    const membership = this.memberships.get(vehicleId);
    const command = this.commands.get(vehicleId);
    const active = Boolean(command && nowMs < command.expiresAt);
    if (!membership && !active && !this.recoveryCounts.has(vehicleId)) return NONE;
    return {
      cycleId: membership?.cycleId ?? command?.cycleId ?? '',
      cycleSize: membership?.cycleSize ?? command?.cycleSize ?? 0,
      recovering: active,
      recoveryCount: this.recoveryCounts.get(vehicleId) ?? 0
    };
  }

  release(vehicleId: string): void {
    this.observations.delete(vehicleId);
    this.memberships.delete(vehicleId);
    this.commands.delete(vehicleId);
    this.recoveryCounts.delete(vehicleId);
  }

  private currentBlockers(nowMs: number): Map<string, string> {
    const blockers = new Map<string, string>();
    for (const observation of this.observations.values()) {
      if (nowMs - observation.observedAt > OBSERVATION_MAX_AGE_MS) continue;
      if (observation.speedReason !== 'vehicle' || Math.abs(observation.speed) > STATIONARY_SPEED) continue;
      const blocker = this.observations.get(observation.obstacleId);
      if (!blocker || nowMs - blocker.observedAt > OBSERVATION_MAX_AGE_MS) continue;
      if (Math.abs(blocker.speed) > STATIONARY_SPEED || blocker.vehicleId === observation.vehicleId) continue;
      blockers.set(observation.vehicleId, blocker.vehicleId);
    }
    return blockers;
  }

  private selectRecoveryOwner(vehicleIds: readonly string[]): TrafficDeadlockObservation | undefined {
    return vehicleIds
      .map((vehicleId) => this.observations.get(vehicleId))
      .filter((entry): entry is TrafficDeadlockObservation => Boolean(entry?.canReverse))
      .sort((left, right) => (
        junctionRecoveryRank(left.junctionPhase) - junctionRecoveryRank(right.junctionPhase) ||
        left.vehicleId.localeCompare(right.vehicleId)
      ))[0];
  }

  private hasActiveCommand(vehicleIds: readonly string[], nowMs: number): boolean {
    return vehicleIds.some((vehicleId) => {
      const command = this.commands.get(vehicleId);
      return Boolean(command && nowMs < command.expiresAt);
    });
  }

  private expire(nowMs: number): void {
    for (const [vehicleId, observation] of this.observations) {
      if (nowMs - observation.observedAt > OBSERVATION_MAX_AGE_MS) this.observations.delete(vehicleId);
    }
    for (const [vehicleId, command] of this.commands) {
      if (nowMs >= command.expiresAt) this.commands.delete(vehicleId);
    }
  }
}

function findBlockerCycles(blockers: ReadonlyMap<string, string>): string[][] {
  const cycles = new Map<string, string[]>();
  const settled = new Set<string>();
  for (const start of [...blockers.keys()].sort()) {
    if (settled.has(start)) continue;
    const path: string[] = [];
    const pathIndex = new Map<string, number>();
    let current: string | undefined = start;
    while (current && blockers.has(current) && !settled.has(current)) {
      const existingIndex = pathIndex.get(current);
      if (existingIndex !== undefined) {
        const cycle = path.slice(existingIndex);
        if (cycle.length >= 2) cycles.set(cycle.slice().sort().join('|'), cycle);
        break;
      }
      pathIndex.set(current, path.length);
      path.push(current);
      current = blockers.get(current);
    }
    for (const vehicleId of path) settled.add(vehicleId);
  }
  return [...cycles.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, cycle]) => cycle);
}

function junctionRecoveryRank(phase: TrafficJunctionPhase): number {
  switch (phase) {
    case 'none': return 0;
    case 'waiting': return 1;
    case 'approach': return 2;
    case 'crossing': return 3;
    case 'clearing': return 4;
  }
}

export const TRAFFIC_DEADLOCK_TIMING = Object.freeze({
  observationMaxAgeMs: OBSERVATION_MAX_AGE_MS,
  confirmationMs: DEADLOCK_CONFIRMATION_MS,
  recoveryDurationMs: RECOVERY_DURATION_MS,
  recoveryCooldownMs: RECOVERY_COOLDOWN_MS
});
