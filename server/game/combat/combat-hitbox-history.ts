import {vehicleDefinition} from '../../../shared/content/vehicle-catalog.ts';
import type {NpcState, PlayerState, VehicleState} from '../../state.ts';

export const COMBAT_HISTORY_TICKS = 24;
export const COMBAT_HISTORY_RETENTION_MS = 800;
export const PUBLIC_COMBAT_REWIND_MS = 200;
export const HUMANOID_HIT_RADIUS = 11;

type CombatTargetKind = 'player' | 'npc' | 'vehicle';

interface CircleHitbox {
  readonly shape: 'circle';
  readonly radius: number;
}

interface BoxHitbox {
  readonly shape: 'box';
  readonly halfLength: number;
  readonly halfWidth: number;
}

type CombatHitbox = CircleHitbox | BoxHitbox;

export interface HistoricalCombatBody {
  readonly id: string;
  readonly kind: CombatTargetKind;
  readonly lifecycleRevision: number;
  readonly spaceId: string;
  readonly x: number;
  readonly y: number;
  readonly angle: number;
  readonly hitbox: CombatHitbox;
}

export interface CombatHistoryFrame {
  readonly serverTick: number;
  readonly serverTimeMs: number;
  readonly worldCollisionRevision: number;
  readonly bodies: readonly HistoricalCombatBody[];
}

export interface HistoricalSegmentQuery {
  readonly requestedServerTimeMs: number;
  readonly nowMs: number;
  readonly startX: number;
  readonly startY: number;
  readonly endX: number;
  readonly endY: number;
  readonly projectileRadius?: number;
  readonly excludedIds?: ReadonlySet<string>;
  readonly kinds?: ReadonlySet<CombatTargetKind>;
}

export interface HistoricalCombatHit {
  readonly id: string;
  readonly kind: CombatTargetKind;
  readonly progress: number;
  readonly x: number;
  readonly y: number;
  readonly angle: number;
  readonly lifecycleRevision: number;
}

export interface HistoricalSegmentResult {
  readonly requestedServerTimeMs: number;
  readonly effectiveServerTimeMs: number;
  readonly rewindMs: number;
  readonly clamped: boolean;
  readonly sourceTick: number;
  readonly sourceTimeMs: number;
  readonly worldCollisionRevision: number;
  readonly hit?: HistoricalCombatHit;
}

interface TrackedIdentity {
  reference: object;
  lifecycleRevision: number;
  present: boolean;
  topology: string;
}

interface CombatHitboxHistoryOptions {
  readonly historyTicks?: number;
  readonly retentionMs?: number;
  readonly publicRewindMs?: number;
}

export class CombatHitboxHistory {
  private readonly frames: CombatHistoryFrame[] = [];
  private readonly identities = new Map<string, TrackedIdentity>();
  private readonly historyTicks: number;
  private readonly retentionMs: number;
  private readonly publicRewindMs: number;

  constructor(options: CombatHitboxHistoryOptions = {}) {
    this.historyTicks = positiveInteger(options.historyTicks, COMBAT_HISTORY_TICKS);
    this.retentionMs = positiveNumber(options.retentionMs, COMBAT_HISTORY_RETENTION_MS);
    this.publicRewindMs = positiveNumber(options.publicRewindMs, PUBLIC_COMBAT_REWIND_MS);
  }

  capture(input: {
    readonly serverTick: number;
    readonly serverTimeMs: number;
    readonly worldCollisionRevision: number;
    readonly players: Iterable<PlayerState>;
    readonly npcs: Iterable<NpcState>;
    readonly vehicles: Iterable<VehicleState>;
  }): CombatHistoryFrame {
    const bodies: HistoricalCombatBody[] = [];
    for (const player of input.players) {
      if (!player.alive || player.vehicleId || player.spaceId !== 'street') continue;
      bodies.push(this.circleBody('player', player.id, player, player.x, player.y, player.angle));
    }
    for (const npc of input.npcs) {
      if (!npc.alive) continue;
      bodies.push(this.circleBody('npc', npc.id, npc, npc.x, npc.y, npc.angle));
    }
    for (const vehicle of input.vehicles) {
      if (vehicle.destroyed) continue;
      const collision = vehicleDefinition(vehicle.kind).collision;
      const topology = `box:${collision.length}:${collision.width}`;
      bodies.push(Object.freeze({
        id: vehicle.id,
        kind: 'vehicle',
        lifecycleRevision: this.lifecycleRevision('vehicle', vehicle.id, vehicle, topology),
        spaceId: 'street',
        x: vehicle.x,
        y: vehicle.y,
        angle: vehicle.angle,
        hitbox: Object.freeze({
          shape: 'box',
          halfLength: collision.length / 2,
          halfWidth: collision.width / 2
        })
      }));
    }
    bodies.sort(compareBodies);
    const presentKeys = new Set(bodies.map((body) => `${body.kind}:${body.id}`));
    for (const [key, identity] of this.identities) {
      if (!presentKeys.has(key)) identity.present = false;
    }
    const frame = Object.freeze({
      serverTick: input.serverTick,
      serverTimeMs: input.serverTimeMs,
      worldCollisionRevision: input.worldCollisionRevision,
      bodies: Object.freeze(bodies)
    });
    this.frames.push(frame);
    this.prune(input.serverTimeMs);
    return frame;
  }

  querySegment(input: HistoricalSegmentQuery): HistoricalSegmentResult | undefined {
    if (this.frames.length === 0) return undefined;
    const latest = this.frames[this.frames.length - 1];
    const oldest = this.frames[0];
    const requested = Number.isFinite(input.requestedServerTimeMs)
      ? input.requestedServerTimeMs
      : input.nowMs;
    const minimum = Math.max(oldest.serverTimeMs, input.nowMs - this.publicRewindMs);
    const maximum = Math.min(input.nowMs, latest.serverTimeMs);
    const effective = clamp(requested, minimum, maximum);
    const sample = this.sample(effective);
    if (!sample) return undefined;
    const projectileRadius = Math.max(0, Number(input.projectileRadius) || 0);
    let hit: HistoricalCombatHit | undefined;
    for (const body of sample.bodies) {
      if (input.excludedIds?.has(body.id) || (input.kinds && !input.kinds.has(body.kind))) continue;
      const progress = segmentHitProgress(input, body, projectileRadius);
      if (progress === undefined) continue;
      const candidate = Object.freeze({
        id: body.id,
        kind: body.kind,
        progress,
        x: body.x,
        y: body.y,
        angle: body.angle,
        lifecycleRevision: body.lifecycleRevision
      });
      if (!hit || compareHits(candidate, hit) < 0) hit = candidate;
    }
    return Object.freeze({
      requestedServerTimeMs: requested,
      effectiveServerTimeMs: effective,
      rewindMs: Math.max(0, input.nowMs - effective),
      clamped: effective !== requested,
      sourceTick: sample.sourceTick,
      sourceTimeMs: sample.sourceTimeMs,
      worldCollisionRevision: sample.worldCollisionRevision,
      hit
    });
  }

  size(): number {
    return this.frames.length;
  }

  oldestTimeMs(): number | undefined {
    return this.frames[0]?.serverTimeMs;
  }

  clear(): void {
    this.frames.length = 0;
    this.identities.clear();
  }

  private circleBody(
    kind: 'player' | 'npc',
    id: string,
    reference: object,
    x: number,
    y: number,
    angle: number
  ): HistoricalCombatBody {
    const topology = `circle:${HUMANOID_HIT_RADIUS}`;
    return Object.freeze({
      id,
      kind,
      lifecycleRevision: this.lifecycleRevision(kind, id, reference, topology),
      spaceId: 'street',
      x,
      y,
      angle,
      hitbox: Object.freeze({shape: 'circle', radius: HUMANOID_HIT_RADIUS})
    });
  }

  private lifecycleRevision(
    kind: CombatTargetKind,
    id: string,
    reference: object,
    topology: string
  ): number {
    const key = `${kind}:${id}`;
    const tracked = this.identities.get(key);
    if (!tracked) {
      this.identities.set(key, {reference, lifecycleRevision: 1, present: true, topology});
      return 1;
    }
    if (!tracked.present || tracked.reference !== reference || tracked.topology !== topology) {
      tracked.lifecycleRevision++;
      tracked.reference = reference;
      tracked.topology = topology;
    }
    tracked.present = true;
    return tracked.lifecycleRevision;
  }

  private prune(nowMs: number): void {
    while (this.frames.length > this.historyTicks) this.frames.shift();
    while (
      this.frames.length > 1 &&
      nowMs - this.frames[0].serverTimeMs > this.retentionMs
    ) this.frames.shift();
  }

  private sample(serverTimeMs: number): {
    readonly sourceTick: number;
    readonly sourceTimeMs: number;
    readonly worldCollisionRevision: number;
    readonly bodies: readonly HistoricalCombatBody[];
  } | undefined {
    let before: CombatHistoryFrame | undefined;
    let after: CombatHistoryFrame | undefined;
    for (const frame of this.frames) {
      if (frame.serverTimeMs <= serverTimeMs) before = frame;
      if (frame.serverTimeMs >= serverTimeMs) {
        after = frame;
        break;
      }
    }
    if (!before) return undefined;
    if (!after || after === before || after.serverTimeMs === before.serverTimeMs) {
      return {
        sourceTick: before.serverTick,
        sourceTimeMs: before.serverTimeMs,
        worldCollisionRevision: before.worldCollisionRevision,
        bodies: before.bodies
      };
    }
    const progress = (serverTimeMs - before.serverTimeMs) /
      (after.serverTimeMs - before.serverTimeMs);
    const afterByKey = new Map(after.bodies.map((body) => [`${body.kind}:${body.id}`, body]));
    const bodies = before.bodies.map((body) => {
      const next = afterByKey.get(`${body.kind}:${body.id}`);
      if (!next || !sameTopology(body, next)) return body;
      return Object.freeze({
        ...body,
        x: lerp(body.x, next.x, progress),
        y: lerp(body.y, next.y, progress),
        angle: lerpAngle(body.angle, next.angle, progress)
      });
    });
    return {
      sourceTick: before.serverTick,
      sourceTimeMs: serverTimeMs,
      worldCollisionRevision: before.worldCollisionRevision,
      bodies
    };
  }
}

function segmentHitProgress(
  segment: Pick<HistoricalSegmentQuery, 'startX' | 'startY' | 'endX' | 'endY'>,
  body: HistoricalCombatBody,
  projectileRadius: number
): number | undefined {
  if (body.hitbox.shape === 'circle') {
    return segmentCircleProgress(segment, body, body.hitbox.radius + projectileRadius);
  }
  const cosine = Math.cos(body.angle);
  const sine = Math.sin(body.angle);
  const startDifferenceX = segment.startX - body.x;
  const startDifferenceY = segment.startY - body.y;
  const endDifferenceX = segment.endX - body.x;
  const endDifferenceY = segment.endY - body.y;
  return segmentAabbProgress(
    startDifferenceX * cosine + startDifferenceY * sine,
    -startDifferenceX * sine + startDifferenceY * cosine,
    endDifferenceX * cosine + endDifferenceY * sine,
    -endDifferenceX * sine + endDifferenceY * cosine,
    body.hitbox.halfLength + projectileRadius,
    body.hitbox.halfWidth + projectileRadius
  );
}

function segmentCircleProgress(
  segment: Pick<HistoricalSegmentQuery, 'startX' | 'startY' | 'endX' | 'endY'>,
  body: HistoricalCombatBody,
  radius: number
): number | undefined {
  const offsetX = segment.startX - body.x;
  const offsetY = segment.startY - body.y;
  if (offsetX * offsetX + offsetY * offsetY <= radius * radius) return 0;
  const directionX = segment.endX - segment.startX;
  const directionY = segment.endY - segment.startY;
  const a = directionX * directionX + directionY * directionY;
  if (a <= Number.EPSILON) return undefined;
  const b = 2 * (offsetX * directionX + offsetY * directionY);
  const c = offsetX * offsetX + offsetY * offsetY - radius * radius;
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return undefined;
  const progress = (-b - Math.sqrt(discriminant)) / (2 * a);
  return progress >= 0 && progress <= 1 ? progress : undefined;
}

function segmentAabbProgress(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  halfLength: number,
  halfWidth: number
): number | undefined {
  let entry = 0;
  let exit = 1;
  for (const [start, delta, extent] of [
    [startX, endX - startX, halfLength],
    [startY, endY - startY, halfWidth]
  ] as const) {
    if (Math.abs(delta) <= Number.EPSILON) {
      if (start < -extent || start > extent) return undefined;
      continue;
    }
    const first = (-extent - start) / delta;
    const second = (extent - start) / delta;
    entry = Math.max(entry, Math.min(first, second));
    exit = Math.min(exit, Math.max(first, second));
    if (entry > exit) return undefined;
  }
  return entry >= 0 && entry <= 1 ? entry : undefined;
}

function sameTopology(first: HistoricalCombatBody, second: HistoricalCombatBody): boolean {
  if (
    first.lifecycleRevision !== second.lifecycleRevision ||
    first.spaceId !== second.spaceId ||
    first.hitbox.shape !== second.hitbox.shape
  ) return false;
  if (first.hitbox.shape === 'circle' && second.hitbox.shape === 'circle') {
    return first.hitbox.radius === second.hitbox.radius;
  }
  return first.hitbox.shape === 'box' && second.hitbox.shape === 'box' &&
    first.hitbox.halfLength === second.hitbox.halfLength &&
    first.hitbox.halfWidth === second.hitbox.halfWidth;
}

function compareBodies(first: HistoricalCombatBody, second: HistoricalCombatBody): number {
  return stableBodyKey(first).localeCompare(stableBodyKey(second));
}

function compareHits(first: HistoricalCombatHit, second: HistoricalCombatHit): number {
  const progress = first.progress - second.progress;
  return Math.abs(progress) > 1e-9
    ? progress
    : stableBodyKey(first).localeCompare(stableBodyKey(second));
}

function stableBodyKey(body: Pick<HistoricalCombatBody, 'kind' | 'id'>): string {
  return `${body.kind}:${body.id}`;
}

function lerp(from: number, to: number, progress: number): number {
  return from + (to - from) * progress;
}

function lerpAngle(from: number, to: number, progress: number): number {
  const difference = Math.atan2(Math.sin(to - from), Math.cos(to - from));
  return from + difference * progress;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return Number.isInteger(value) && Number(value) > 0 ? Number(value) : fallback;
}

function positiveNumber(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && Number(value) > 0 ? Number(value) : fallback;
}
