import type {PoliceAwarenessPhase, PoliceSearchZone} from '../../../shared/protocol/police-awareness.ts';
import {PoliceHelicopterState, type DistrictState} from '../../state.ts';
import type {CollisionMap} from '../../world-map.ts';

export type PoliceHelicopterPhase = 'approach' | 'track' | 'search' | 'depart';

export interface PoliceHelicopterTarget {
  suspectId: string;
  wantedLevel: number;
  awareness: PoliceAwarenessPhase;
  currentX: number;
  currentY: number;
  lastKnownX: number;
  lastKnownY: number;
}

export interface PoliceHelicopterDiagnostic {
  id: string;
  suspectId: string;
  phase: PoliceHelicopterPhase;
  altitude: number;
  distanceToFocus: number;
  spotlightDistanceToSuspect: number;
}

export interface PoliceHelicopterPolicy {
  maximumDistrictHelicopters: number;
  initialSpawnDelayMs: number;
  reinforcementIntervalMs: number;
  spawnDistance: number;
  cruiseAltitude: number;
  standoffDistance: number;
  approachDistance: number;
  maximumSpeed: number;
  orbitSpeed: number;
  spotlightRadius: number;
  searchSweepRadius: number;
  departAltitude: number;
  visibilityCheckIntervalMs: number;
  flightUpdateIntervalMs: number;
}

export const POLICE_HELICOPTER_POLICY: Readonly<PoliceHelicopterPolicy> = Object.freeze({
  maximumDistrictHelicopters: 2,
  initialSpawnDelayMs: 4_500,
  reinforcementIntervalMs: 15_000,
  spawnDistance: 1_080,
  cruiseAltitude: 164,
  standoffDistance: 310,
  approachDistance: 560,
  maximumSpeed: 270,
  orbitSpeed: 92,
  spotlightRadius: 112,
  searchSweepRadius: 170,
  departAltitude: 380,
  visibilityCheckIntervalMs: 100,
  flightUpdateIntervalMs: 1_000 / 15
});

const MAXIMUM_FLIGHT_CATCH_UP_SECONDS = 0.25;

interface PoliceHelicopterRuntime {
  orbitDirection: -1 | 1;
  scanOffset: number;
  previousTargetX: number;
  previousTargetY: number;
  targetVelocityX: number;
  targetVelocityY: number;
  lastTargetSampleAt: number;
  lastVisibilityCheckAt: number;
  lastCanSeeTarget: boolean;
}

interface PoliceHelicopterControllerOptions {
  state: DistrictState;
  world: CollisionMap;
  targets: (nowMs: number) => readonly PoliceHelicopterTarget[];
  reportObservation: (suspectId: string, canSeeTarget: boolean, nowMs: number) => void;
  policy?: Partial<PoliceHelicopterPolicy>;
}

/**
 * Owns the authoritative aerial response. Flight deliberately ignores the road graph;
 * awareness still comes from the moving searchlight rather than omniscient player tracking.
 */
export class PoliceHelicopterController {
  private readonly runtimes = new Map<string, PoliceHelicopterRuntime>();
  private readonly policy: Readonly<PoliceHelicopterPolicy>;
  private spawnSequence = 0;
  private nextSpawnAt = 0;
  private flightAccumulatorSeconds = 0;

  constructor(private readonly options: PoliceHelicopterControllerOptions) {
    this.policy = Object.freeze({...POLICE_HELICOPTER_POLICY, ...options.policy});
  }

  update(deltaSeconds: number, nowMs: number): void {
    const targets = normalizeTargets(this.options.targets(nowMs));
    const targetById = new Map(targets.map((target) => [target.suspectId, target]));
    const desiredAssignments = desiredHelicopterAssignments(
      targets,
      this.policy.maximumDistrictHelicopters
    );
    const desiredCounts = countAssignments(desiredAssignments);
    this.markSurplusForDeparture(desiredCounts);
    this.spawnDeficit(desiredAssignments, nowMs);

    const flightIntervalSeconds = this.policy.flightUpdateIntervalMs / 1000;
    this.flightAccumulatorSeconds = Math.min(
      MAXIMUM_FLIGHT_CATCH_UP_SECONDS,
      this.flightAccumulatorSeconds + Math.max(0, deltaSeconds)
    );
    if (this.flightAccumulatorSeconds + Number.EPSILON < flightIntervalSeconds) return;
    const flightDeltaSeconds = this.flightAccumulatorSeconds;
    this.flightAccumulatorSeconds = 0;

    for (const [id, helicopter] of this.options.state.policeHelicopters) {
      const runtime = this.runtimes.get(id) ?? this.createRuntime(helicopter, nowMs);
      if (helicopter.phase === 'depart') {
        this.updateDeparture(helicopter, flightDeltaSeconds);
        if (this.shouldRemove(helicopter)) this.remove(id);
        continue;
      }
      const target = targetById.get(helicopter.suspectId);
      if (!target) {
        helicopter.phase = 'depart';
        continue;
      }
      this.updatePursuit(helicopter, runtime, target, flightDeltaSeconds, nowMs);
    }
  }

  searchZonesFor(suspectId: string): PoliceSearchZone[] {
    return [...this.options.state.policeHelicopters.values()]
      .filter((helicopter) => helicopter.suspectId === suspectId && helicopter.phase !== 'depart')
      .map((helicopter) => {
        const distance = Math.max(1, Math.hypot(
          helicopter.spotlightX - helicopter.x,
          helicopter.spotlightY - helicopter.y
        ));
        return {
          id: `helicopter:${helicopter.id}`,
          unitId: helicopter.id,
          unitKind: 'helicopter' as const,
          x: helicopter.x,
          y: helicopter.y,
          angle: Math.atan2(
            helicopter.spotlightY - helicopter.y,
            helicopter.spotlightX - helicopter.x
          ),
          range: distance + helicopter.spotlightRadius,
          halfAngle: Math.min(Math.PI * 0.34, Math.atan2(helicopter.spotlightRadius, distance))
        };
      })
      .sort((left, right) => left.id.localeCompare(right.id));
  }

  diagnostics(): PoliceHelicopterDiagnostic[] {
    return [...this.options.state.policeHelicopters.values()].map((helicopter) => {
      const player = this.options.state.players.get(helicopter.suspectId);
      return {
        id: helicopter.id,
        suspectId: helicopter.suspectId,
        phase: helicopter.phase as PoliceHelicopterPhase,
        altitude: helicopter.altitude,
        distanceToFocus: player
          ? Math.hypot(player.x - helicopter.x, player.y - helicopter.y)
          : 0,
        spotlightDistanceToSuspect: player
          ? Math.hypot(player.x - helicopter.spotlightX, player.y - helicopter.spotlightY)
          : 0
      };
    }).sort((left, right) => left.id.localeCompare(right.id));
  }

  clear(): void {
    this.options.state.policeHelicopters.clear();
    this.runtimes.clear();
    this.nextSpawnAt = 0;
    this.flightAccumulatorSeconds = 0;
  }

  private markSurplusForDeparture(desiredCounts: ReadonlyMap<string, number>): void {
    const activeBySuspect = new Map<string, PoliceHelicopterState[]>();
    for (const helicopter of this.options.state.policeHelicopters.values()) {
      if (helicopter.phase === 'depart') continue;
      const entries = activeBySuspect.get(helicopter.suspectId) ?? [];
      entries.push(helicopter);
      activeBySuspect.set(helicopter.suspectId, entries);
    }
    for (const [suspectId, helicopters] of activeBySuspect) {
      const desired = desiredCounts.get(suspectId) ?? 0;
      helicopters.sort((left, right) => left.spawnedAt - right.spawnedAt || left.id.localeCompare(right.id));
      for (const helicopter of helicopters.slice(desired)) helicopter.phase = 'depart';
    }
  }

  private spawnDeficit(desiredAssignments: readonly string[], nowMs: number): void {
    const activeCounts = new Map<string, number>();
    for (const helicopter of this.options.state.policeHelicopters.values()) {
      if (helicopter.phase === 'depart') continue;
      activeCounts.set(helicopter.suspectId, (activeCounts.get(helicopter.suspectId) ?? 0) + 1);
    }
    const remaining = new Map(activeCounts);
    const missing = desiredAssignments.filter((suspectId) => {
      const count = remaining.get(suspectId) ?? 0;
      if (count > 0) {
        remaining.set(suspectId, count - 1);
        return false;
      }
      return true;
    });
    if (missing.length === 0) {
      this.nextSpawnAt = 0;
      return;
    }
    if (this.nextSpawnAt === 0) {
      this.nextSpawnAt = nowMs + this.policy.initialSpawnDelayMs;
      return;
    }
    if (nowMs < this.nextSpawnAt) return;
    const target = this.options.targets(nowMs).find((candidate) => candidate.suspectId === missing[0]);
    if (!target) return;
    this.spawn(target, nowMs);
    this.nextSpawnAt = nowMs + this.policy.reinforcementIntervalMs;
  }

  private spawn(target: PoliceHelicopterTarget, nowMs: number): void {
    const sequence = ++this.spawnSequence;
    const spawnAngle = normalizeAngle(sequence * 2.399963 + target.suspectId.length * 0.371);
    const helicopter = new PoliceHelicopterState();
    helicopter.id = `police-helicopter:${sequence}`;
    helicopter.suspectId = target.suspectId;
    helicopter.x = clamp(
      target.lastKnownX + Math.cos(spawnAngle) * this.policy.spawnDistance,
      -this.options.world.tileWidth * 2,
      this.options.world.width * this.options.world.tileWidth + this.options.world.tileWidth * 2
    );
    helicopter.y = clamp(
      target.lastKnownY + Math.sin(spawnAngle) * this.policy.spawnDistance,
      -this.options.world.tileHeight * 2,
      this.options.world.height * this.options.world.tileHeight + this.options.world.tileHeight * 2
    );
    helicopter.altitude = this.policy.cruiseAltitude + ((sequence - 1) % 2) * 24;
    helicopter.angle = Math.atan2(target.lastKnownY - helicopter.y, target.lastKnownX - helicopter.x);
    helicopter.phase = 'approach';
    helicopter.spotlightX = target.lastKnownX;
    helicopter.spotlightY = target.lastKnownY;
    helicopter.spotlightRadius = this.policy.spotlightRadius;
    helicopter.spotlightIntensity = 0.35;
    helicopter.health = 700;
    helicopter.spawnedAt = nowMs;
    this.options.state.policeHelicopters.set(helicopter.id, helicopter);
    this.createRuntime(helicopter, nowMs);
  }

  private createRuntime(helicopter: PoliceHelicopterState, nowMs: number): PoliceHelicopterRuntime {
    const runtime: PoliceHelicopterRuntime = {
      orbitDirection: this.runtimes.size % 2 === 0 ? 1 : -1,
      scanOffset: this.runtimes.size * Math.PI,
      previousTargetX: helicopter.spotlightX,
      previousTargetY: helicopter.spotlightY,
      targetVelocityX: 0,
      targetVelocityY: 0,
      lastTargetSampleAt: nowMs,
      lastVisibilityCheckAt: Number.NEGATIVE_INFINITY,
      lastCanSeeTarget: false
    };
    this.runtimes.set(helicopter.id, runtime);
    return runtime;
  }

  private updatePursuit(
    helicopter: PoliceHelicopterState,
    runtime: PoliceHelicopterRuntime,
    target: PoliceHelicopterTarget,
    deltaSeconds: number,
    nowMs: number
  ): void {
    this.sampleTargetVelocity(runtime, target, nowMs);
    const focusX = target.awareness === 'spotted' ? target.currentX : target.lastKnownX;
    const focusY = target.awareness === 'spotted' ? target.currentY : target.lastKnownY;
    const offsetX = focusX - helicopter.x;
    const offsetY = focusY - helicopter.y;
    const distance = Math.max(1, Math.hypot(offsetX, offsetY));
    const radialX = offsetX / distance;
    const radialY = offsetY / distance;
    let velocityX: number;
    let velocityY: number;
    if (distance > this.policy.approachDistance) {
      helicopter.phase = 'approach';
      const approachSpeed = Math.min(this.policy.maximumSpeed, 125 + (distance - this.policy.approachDistance) * 0.22);
      velocityX = radialX * approachSpeed;
      velocityY = radialY * approachSpeed;
    } else {
      helicopter.phase = target.awareness === 'spotted' ? 'track' : 'search';
      const radialCorrection = clamp(
        (distance - this.policy.standoffDistance) * 1.15,
        -this.policy.orbitSpeed,
        this.policy.maximumSpeed * 0.68
      );
      const orbitSpeed = this.policy.orbitSpeed * (helicopter.phase === 'search' ? 0.72 : 1);
      velocityX = radialX * radialCorrection - radialY * orbitSpeed * runtime.orbitDirection;
      velocityY = radialY * radialCorrection + radialX * orbitSpeed * runtime.orbitDirection;
    }
    const speed = Math.hypot(velocityX, velocityY);
    if (speed > this.policy.maximumSpeed) {
      velocityX *= this.policy.maximumSpeed / speed;
      velocityY *= this.policy.maximumSpeed / speed;
    }
    helicopter.x += velocityX * deltaSeconds;
    helicopter.y += velocityY * deltaSeconds;
    helicopter.speed = Math.hypot(velocityX, velocityY);
    if (helicopter.speed > 1) {
      helicopter.angle = rotateTowards(
        helicopter.angle,
        Math.atan2(velocityY, velocityX),
        deltaSeconds * 1.8
      );
    }
    const slot = Number(helicopter.id.split(':').at(-1) ?? 1) - 1;
    helicopter.altitude = this.policy.cruiseAltitude + (slot % 2) * 24 + Math.sin(nowMs * 0.0013 + slot) * 5;

    const desiredSpotlight = target.awareness === 'spotted'
      ? {
        x: target.currentX + runtime.targetVelocityX * 0.6,
        y: target.currentY + runtime.targetVelocityY * 0.6
      }
      : {
        x: target.lastKnownX + Math.cos(nowMs * 0.00062 + runtime.scanOffset) * this.policy.searchSweepRadius,
        y: target.lastKnownY + Math.sin(nowMs * 0.00083 + runtime.scanOffset) * this.policy.searchSweepRadius * 0.72
      };
    const spotlightFollow = 1 - Math.exp(-deltaSeconds * (target.awareness === 'spotted' ? 2.2 : 1.35));
    helicopter.spotlightX += (desiredSpotlight.x - helicopter.spotlightX) * spotlightFollow;
    helicopter.spotlightY += (desiredSpotlight.y - helicopter.spotlightY) * spotlightFollow;
    helicopter.spotlightIntensity = Math.min(
      1,
      helicopter.spotlightIntensity + deltaSeconds * (helicopter.phase === 'approach' ? 0.35 : 0.8)
    );

    if (nowMs - runtime.lastVisibilityCheckAt >= this.policy.visibilityCheckIntervalMs) {
      const suspect = this.options.state.players.get(target.suspectId);
      runtime.lastCanSeeTarget = Boolean(
        suspect?.alive &&
        suspect.spaceId === 'street' &&
        helicopter.spotlightIntensity >= 0.72 &&
        Math.hypot(suspect.x - helicopter.spotlightX, suspect.y - helicopter.spotlightY) <= helicopter.spotlightRadius &&
        this.options.world.hasLineOfSight(
          helicopter.x,
          helicopter.y,
          suspect.x,
          suspect.y,
          suspect.surfaceId,
          'projectile'
        )
      );
      runtime.lastVisibilityCheckAt = nowMs;
    }
    this.options.reportObservation(target.suspectId, runtime.lastCanSeeTarget, nowMs);
  }

  private sampleTargetVelocity(
    runtime: PoliceHelicopterRuntime,
    target: PoliceHelicopterTarget,
    nowMs: number
  ): void {
    const elapsed = nowMs - runtime.lastTargetSampleAt;
    if (elapsed < 200) return;
    const seconds = elapsed / 1000;
    runtime.targetVelocityX = clamp((target.currentX - runtime.previousTargetX) / seconds, -320, 320);
    runtime.targetVelocityY = clamp((target.currentY - runtime.previousTargetY) / seconds, -320, 320);
    runtime.previousTargetX = target.currentX;
    runtime.previousTargetY = target.currentY;
    runtime.lastTargetSampleAt = nowMs;
  }

  private updateDeparture(helicopter: PoliceHelicopterState, deltaSeconds: number): void {
    const centerX = this.options.world.width * this.options.world.tileWidth * 0.5;
    const centerY = this.options.world.height * this.options.world.tileHeight * 0.5;
    const awayX = helicopter.x - centerX;
    const awayY = helicopter.y - centerY;
    const distance = Math.max(1, Math.hypot(awayX, awayY));
    const speed = this.policy.maximumSpeed * 0.88;
    helicopter.x += awayX / distance * speed * deltaSeconds;
    helicopter.y += awayY / distance * speed * deltaSeconds;
    helicopter.altitude += 72 * deltaSeconds;
    helicopter.speed = speed;
    helicopter.spotlightIntensity = Math.max(0, helicopter.spotlightIntensity - deltaSeconds * 1.6);
    helicopter.angle = rotateTowards(
      helicopter.angle,
      Math.atan2(awayY, awayX),
      deltaSeconds * 1.4
    );
  }

  private shouldRemove(helicopter: PoliceHelicopterState): boolean {
    if (helicopter.altitude >= this.policy.departAltitude) return true;
    const margin = this.options.world.tileWidth * 5;
    return helicopter.x < -margin || helicopter.y < -margin ||
      helicopter.x > this.options.world.width * this.options.world.tileWidth + margin ||
      helicopter.y > this.options.world.height * this.options.world.tileHeight + margin;
  }

  private remove(id: string): void {
    this.options.state.policeHelicopters.delete(id);
    this.runtimes.delete(id);
  }
}

export function helicoptersRequiredForWanted(wantedLevel: number): number {
  const level = Math.max(0, Math.floor(wantedLevel));
  if (level < 4) return 0;
  return level >= 5 ? 2 : 1;
}

export function desiredHelicopterAssignments(
  targets: readonly PoliceHelicopterTarget[],
  maximum: number
): string[] {
  const eligible = normalizeTargets(targets)
    .filter((target) => target.wantedLevel >= 4 && target.awareness !== 'clear');
  const assignments: string[] = [];
  for (const target of eligible) {
    if (assignments.length >= maximum) break;
    assignments.push(target.suspectId);
  }
  for (const target of eligible) {
    if (assignments.length >= maximum) break;
    if (helicoptersRequiredForWanted(target.wantedLevel) >= 2) assignments.push(target.suspectId);
  }
  return assignments;
}

function normalizeTargets(targets: readonly PoliceHelicopterTarget[]): PoliceHelicopterTarget[] {
  const byId = new Map<string, PoliceHelicopterTarget>();
  for (const target of targets) {
    if (!target.suspectId || target.wantedLevel < 4 || target.awareness === 'clear') continue;
    if ([target.currentX, target.currentY, target.lastKnownX, target.lastKnownY]
      .some((value) => !Number.isFinite(value))) continue;
    const current = byId.get(target.suspectId);
    if (!current || target.wantedLevel > current.wantedLevel) byId.set(target.suspectId, {...target});
  }
  return [...byId.values()].sort((left, right) => (
    right.wantedLevel - left.wantedLevel || left.suspectId.localeCompare(right.suspectId)
  ));
}

function countAssignments(assignments: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const suspectId of assignments) counts.set(suspectId, (counts.get(suspectId) ?? 0) + 1);
  return counts;
}

function rotateTowards(current: number, target: number, maximumStep: number): number {
  const difference = normalizeAngle(target - current);
  if (Math.abs(difference) <= maximumStep) return normalizeAngle(target);
  return normalizeAngle(current + Math.sign(difference) * maximumStep);
}

function normalizeAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
