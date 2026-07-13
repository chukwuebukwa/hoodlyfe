export interface MotionSnapshot {
  timeMs: number;
  x: number;
  y: number;
  angle: number;
}

const MAX_SNAPSHOTS = 24;
const TELEPORT_DISTANCE = 180;

export class MotionSnapshotBuffer {
  private readonly snapshots: MotionSnapshot[] = [];

  push(snapshot: MotionSnapshot): void {
    if (!Number.isFinite(snapshot.timeMs) || snapshot.timeMs < 0) return;
    const previous = this.snapshots.at(-1);
    if (previous && snapshot.timeMs < previous.timeMs) return;
    if (previous?.timeMs === snapshot.timeMs) this.snapshots.pop();
    this.snapshots.push({...snapshot});
    if (this.snapshots.length > MAX_SNAPSHOTS) {
      this.snapshots.splice(0, this.snapshots.length - MAX_SNAPSHOTS);
    }
  }

  sample(timeMs: number): MotionSnapshot | undefined {
    const first = this.snapshots[0];
    if (!first) return undefined;
    if (timeMs <= first.timeMs) return {...first};
    const last = this.snapshots.at(-1)!;
    if (timeMs >= last.timeMs) return {...last};
    for (let index = 1; index < this.snapshots.length; index++) {
      const right = this.snapshots[index];
      if (right.timeMs < timeMs) continue;
      const left = this.snapshots[index - 1];
      if (Math.hypot(right.x - left.x, right.y - left.y) > TELEPORT_DISTANCE) {
        return {...right};
      }
      const factor = clamp((timeMs - left.timeMs) / Math.max(1, right.timeMs - left.timeMs), 0, 1);
      return {
        timeMs,
        x: lerp(left.x, right.x, factor),
        y: lerp(left.y, right.y, factor),
        angle: normalizeAngle(left.angle + normalizeAngle(right.angle - left.angle) * factor)
      };
    }
    return {...last};
  }
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
