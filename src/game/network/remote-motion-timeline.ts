export interface RemoteMotionSnapshot {
  timeMs: number;
  x: number;
  y: number;
  angle: number;
  velocityX?: number;
  velocityY?: number;
  elevation?: number;
  verticalVelocity?: number;
  surfaceId?: string;
}

export type RemoteMotionSampleMode =
  | 'interpolated'
  | 'extrapolated'
  | 'held'
  | 'teleported';

export interface RemoteMotionSample extends RemoteMotionSnapshot {
  mode: RemoteMotionSampleMode;
  snapshotAgeMs: number;
  extrapolationMs: number;
  bufferUnderrun: boolean;
  bufferSize: number;
}

export interface RemoteMotionTimelineOptions {
  maximumSnapshots?: number;
  teleportDistance?: number;
  maximumSnapshotGapMs?: number;
  maximumExtrapolationMs?: number;
  maximumExtrapolationSpeed?: number;
  maximumAngularSpeed?: number;
}

interface ResolvedOptions {
  maximumSnapshots: number;
  teleportDistance: number;
  maximumSnapshotGapMs: number;
  maximumExtrapolationMs: number;
  maximumExtrapolationSpeed: number;
  maximumAngularSpeed: number;
}

const DEFAULT_OPTIONS: ResolvedOptions = Object.freeze({
  maximumSnapshots: 32,
  teleportDistance: 180,
  maximumSnapshotGapMs: 500,
  maximumExtrapolationMs: 100,
  maximumExtrapolationSpeed: 900,
  maximumAngularSpeed: Math.PI * 4
});

export class RemoteMotionTimeline {
  private readonly snapshots: RemoteMotionSnapshot[] = [];
  private readonly options: ResolvedOptions;
  private lastDiscontinuityAt = Number.NEGATIVE_INFINITY;

  constructor(options: RemoteMotionTimelineOptions = {}) {
    this.options = resolveOptions(options);
  }

  push(snapshot: RemoteMotionSnapshot): boolean {
    const accepted = sanitizeSnapshot(snapshot);
    if (!accepted) return false;
    const previous = this.snapshots.at(-1);
    if (previous && accepted.timeMs < previous.timeMs) return false;
    if (previous?.timeMs === accepted.timeMs) this.snapshots.pop();
    const currentPrevious = this.snapshots.at(-1);
    if (currentPrevious && this.isDiscontinuity(currentPrevious, accepted)) {
      this.snapshots.splice(0);
      this.lastDiscontinuityAt = accepted.timeMs;
    }
    this.snapshots.push(accepted);
    if (this.snapshots.length > this.options.maximumSnapshots) {
      this.snapshots.splice(0, this.snapshots.length - this.options.maximumSnapshots);
    }
    return true;
  }

  sample(renderTimeMs: number, estimatedServerTimeMs = renderTimeMs): RemoteMotionSample | undefined {
    const first = this.snapshots[0];
    if (!first) return undefined;
    const targetTime = finite(renderTimeMs, first.timeMs);
    const serverNow = Math.max(targetTime, finite(estimatedServerTimeMs, targetTime));
    const last = this.snapshots.at(-1)!;
    const snapshotAgeMs = Math.max(0, serverNow - last.timeMs);
    if (targetTime <= first.timeMs) {
      return this.result(
        first,
        first.timeMs === this.lastDiscontinuityAt ? 'teleported' : 'held',
        snapshotAgeMs,
        0,
        targetTime < first.timeMs
      );
    }
    for (let index = 1; index < this.snapshots.length; index++) {
      const right = this.snapshots[index];
      if (right.timeMs < targetTime) continue;
      const left = this.snapshots[index - 1];
      const factor = clamp(
        (targetTime - left.timeMs) / Math.max(1, right.timeMs - left.timeMs),
        0,
        1
      );
      return this.result({
        timeMs: targetTime,
        x: lerp(left.x, right.x, factor),
        y: lerp(left.y, right.y, factor),
        angle: normalizeAngle(left.angle + normalizeAngle(right.angle - left.angle) * factor),
        velocityX: lerp(optionalFinite(left.velocityX), optionalFinite(right.velocityX), factor),
        velocityY: lerp(optionalFinite(left.velocityY), optionalFinite(right.velocityY), factor),
        elevation: lerpOptional(left.elevation, right.elevation, factor),
        verticalVelocity: lerpOptional(
          left.verticalVelocity,
          right.verticalVelocity,
          factor
        ),
        surfaceId: left.surfaceId
      }, 'interpolated', snapshotAgeMs, 0, false);
    }
    const extrapolationMs = Math.max(0, targetTime - last.timeMs);
    const previous = this.snapshots.at(-2);
    if (
      previous &&
      last.timeMs !== this.lastDiscontinuityAt &&
      extrapolationMs > 0 &&
      extrapolationMs <= this.options.maximumExtrapolationMs
    ) {
      return this.result(
        extrapolate(previous, last, extrapolationMs, this.options),
        'extrapolated',
        snapshotAgeMs,
        extrapolationMs,
        false
      );
    }
    return this.result(last, 'held', snapshotAgeMs, extrapolationMs, extrapolationMs > 0);
  }

  clear(): void {
    this.snapshots.splice(0);
    this.lastDiscontinuityAt = Number.NEGATIVE_INFINITY;
  }

  size(): number {
    return this.snapshots.length;
  }

  private isDiscontinuity(left: RemoteMotionSnapshot, right: RemoteMotionSnapshot): boolean {
    return right.timeMs - left.timeMs > this.options.maximumSnapshotGapMs ||
      left.surfaceId !== right.surfaceId ||
      Math.hypot(right.x - left.x, right.y - left.y) > this.options.teleportDistance;
  }

  private result(
    snapshot: RemoteMotionSnapshot,
    mode: RemoteMotionSampleMode,
    snapshotAgeMs: number,
    extrapolationMs: number,
    bufferUnderrun: boolean
  ): RemoteMotionSample {
    return {
      ...snapshot,
      mode,
      snapshotAgeMs,
      extrapolationMs,
      bufferUnderrun,
      bufferSize: this.snapshots.length
    };
  }
}

function extrapolate(
  previous: RemoteMotionSnapshot,
  latest: RemoteMotionSnapshot,
  extrapolationMs: number,
  options: ResolvedOptions
): RemoteMotionSnapshot {
  const intervalSeconds = Math.max(0.001, (latest.timeMs - previous.timeMs) / 1_000);
  const derivedVelocityX = (latest.x - previous.x) / intervalSeconds;
  const derivedVelocityY = (latest.y - previous.y) / intervalSeconds;
  let velocityX = Number.isFinite(latest.velocityX) ? latest.velocityX! : derivedVelocityX;
  let velocityY = Number.isFinite(latest.velocityY) ? latest.velocityY! : derivedVelocityY;
  const speed = Math.hypot(velocityX, velocityY);
  if (speed > options.maximumExtrapolationSpeed) {
    const scale = options.maximumExtrapolationSpeed / speed;
    velocityX *= scale;
    velocityY *= scale;
  }
  const angularVelocity = clamp(
    normalizeAngle(latest.angle - previous.angle) / intervalSeconds,
    -options.maximumAngularSpeed,
    options.maximumAngularSpeed
  );
  const seconds = extrapolationMs / 1_000;
  return {
    timeMs: latest.timeMs + extrapolationMs,
    x: latest.x + velocityX * seconds,
    y: latest.y + velocityY * seconds,
    angle: normalizeAngle(latest.angle + angularVelocity * seconds),
    velocityX,
    velocityY,
    elevation: Number.isFinite(latest.elevation)
      ? latest.elevation! + optionalFinite(latest.verticalVelocity) * seconds
      : undefined,
    verticalVelocity: Number.isFinite(latest.verticalVelocity)
      ? latest.verticalVelocity
      : undefined,
    surfaceId: latest.surfaceId
  };
}

function sanitizeSnapshot(snapshot: RemoteMotionSnapshot): RemoteMotionSnapshot | undefined {
  if (
    !Number.isFinite(snapshot?.timeMs) || snapshot.timeMs < 0 ||
    !Number.isFinite(snapshot.x) || !Number.isFinite(snapshot.y) ||
    !Number.isFinite(snapshot.angle)
  ) return undefined;
  return {
    timeMs: snapshot.timeMs,
    x: snapshot.x,
    y: snapshot.y,
    angle: normalizeAngle(snapshot.angle),
    velocityX: Number.isFinite(snapshot.velocityX) ? snapshot.velocityX : undefined,
    velocityY: Number.isFinite(snapshot.velocityY) ? snapshot.velocityY : undefined,
    elevation: Number.isFinite(snapshot.elevation) ? snapshot.elevation : undefined,
    verticalVelocity: Number.isFinite(snapshot.verticalVelocity)
      ? snapshot.verticalVelocity
      : undefined,
    surfaceId: typeof snapshot.surfaceId === 'string' ? snapshot.surfaceId : undefined
  };
}

function resolveOptions(options: RemoteMotionTimelineOptions): ResolvedOptions {
  return {
    maximumSnapshots: positiveInteger(options.maximumSnapshots, DEFAULT_OPTIONS.maximumSnapshots),
    teleportDistance: positive(options.teleportDistance, DEFAULT_OPTIONS.teleportDistance),
    maximumSnapshotGapMs: positive(
      options.maximumSnapshotGapMs,
      DEFAULT_OPTIONS.maximumSnapshotGapMs
    ),
    maximumExtrapolationMs: positiveOrZero(
      options.maximumExtrapolationMs,
      DEFAULT_OPTIONS.maximumExtrapolationMs
    ),
    maximumExtrapolationSpeed: positive(
      options.maximumExtrapolationSpeed,
      DEFAULT_OPTIONS.maximumExtrapolationSpeed
    ),
    maximumAngularSpeed: positive(options.maximumAngularSpeed, DEFAULT_OPTIONS.maximumAngularSpeed)
  };
}

function optionalFinite(value: number | undefined): number {
  return Number.isFinite(value) ? value! : 0;
}

function lerpOptional(
  left: number | undefined,
  right: number | undefined,
  factor: number
): number | undefined {
  if (!Number.isFinite(left) && !Number.isFinite(right)) return undefined;
  if (!Number.isFinite(left)) return right;
  if (!Number.isFinite(right)) return left;
  return lerp(left!, right!, factor);
}

function finite(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function positive(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && value! > 0 ? value! : fallback;
}

function positiveOrZero(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && value! >= 0 ? value! : fallback;
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return Number.isSafeInteger(value) && value! > 0 ? value! : fallback;
}

function lerp(left: number, right: number, factor: number): number {
  return left + (right - left) * factor;
}

function normalizeAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
