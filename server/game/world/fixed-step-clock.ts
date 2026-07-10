export interface SimulationFrame {
  tick: number;
  nowMs: number;
  deltaMs: number;
  deltaSeconds: number;
}

export interface FixedStepClockOptions {
  stepMs?: number;
  maxCatchUpSteps?: number;
  maxElapsedMs?: number;
}

export class FixedStepClock {
  readonly stepMs: number;
  readonly maxCatchUpSteps: number;
  readonly maxElapsedMs: number;

  private accumulatorMs = 0;
  private currentTick = 0;
  private discardedMs = 0;

  constructor(options: FixedStepClockOptions = {}) {
    this.stepMs = positive(options.stepMs ?? 1000 / 30, 'stepMs');
    this.maxCatchUpSteps = positiveInteger(options.maxCatchUpSteps ?? 5, 'maxCatchUpSteps');
    this.maxElapsedMs = positive(options.maxElapsedMs ?? 250, 'maxElapsedMs');
  }

  get tick(): number {
    return this.currentTick;
  }

  get nowMs(): number {
    return this.currentTick * this.stepMs;
  }

  get droppedMs(): number {
    return this.discardedMs;
  }

  reset(): void {
    this.accumulatorMs = 0;
    this.currentTick = 0;
    this.discardedMs = 0;
  }

  advance(elapsedMs: number, runStep: (frame: SimulationFrame) => void): number {
    const safeElapsed = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0;
    const acceptedElapsed = Math.min(safeElapsed, this.maxElapsedMs);
    this.discardedMs += safeElapsed - acceptedElapsed;
    this.accumulatorMs += acceptedElapsed;

    let steps = 0;
    while (this.accumulatorMs + Number.EPSILON >= this.stepMs && steps < this.maxCatchUpSteps) {
      this.accumulatorMs -= this.stepMs;
      this.currentTick += 1;
      steps += 1;
      runStep({
        tick: this.currentTick,
        nowMs: this.nowMs,
        deltaMs: this.stepMs,
        deltaSeconds: this.stepMs / 1000
      });
    }

    if (this.accumulatorMs >= this.stepMs) {
      const droppedSteps = Math.floor(this.accumulatorMs / this.stepMs);
      const dropped = droppedSteps * this.stepMs;
      this.accumulatorMs -= dropped;
      this.discardedMs += dropped;
    }

    return steps;
  }
}

function positive(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive finite number.`);
  }
  return value;
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive integer.`);
  }
  return value;
}
