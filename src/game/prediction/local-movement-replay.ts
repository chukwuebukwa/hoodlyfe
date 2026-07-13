import type {MovementVector} from '../input/client-input-policy.ts';

interface MovementSample extends MovementVector {
  timeMs: number;
}

const MAX_REPLAY_WINDOW_MS = 250;

export class LocalMovementReplay {
  private readonly samples: MovementSample[] = [];

  record(timeMs: number, movement: MovementVector): void {
    if (!Number.isFinite(timeMs)) return;
    const previous = this.samples.at(-1);
    if (previous && previous.x === movement.x && previous.y === movement.y) return;
    this.samples.push({timeMs, ...movement});
    const cutoff = timeMs - 2_500;
    while (this.samples.length > 1 && this.samples[1].timeMs < cutoff) this.samples.shift();
  }

  replay(
    base: {x: number; y: number},
    fromClientTimeMs: number,
    toClientTimeMs: number,
    speed: number
  ): {x: number; y: number} {
    if (toClientTimeMs <= fromClientTimeMs || this.samples.length === 0) return {...base};
    fromClientTimeMs = Math.max(fromClientTimeMs, toClientTimeMs - MAX_REPLAY_WINDOW_MS);
    let active = this.samples[0];
    for (const sample of this.samples) {
      if (sample.timeMs > fromClientTimeMs) break;
      active = sample;
    }
    let cursor = fromClientTimeMs;
    let x = base.x;
    let y = base.y;
    for (const sample of this.samples) {
      if (sample.timeMs <= fromClientTimeMs || sample.timeMs > toClientTimeMs) continue;
      const seconds = Math.max(0, sample.timeMs - cursor) / 1000;
      x += active.x * speed * seconds;
      y += active.y * speed * seconds;
      active = sample;
      cursor = sample.timeMs;
    }
    const seconds = Math.max(0, toClientTimeMs - cursor) / 1000;
    return {x: x + active.x * speed * seconds, y: y + active.y * speed * seconds};
  }
}
