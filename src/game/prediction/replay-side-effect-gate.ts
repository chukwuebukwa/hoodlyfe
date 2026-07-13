export type ReplayEffectClass =
  | 'pure-state'
  | 'idempotent-presentation'
  | 'one-shot-presentation'
  | 'authoritative-gameplay'
  | 'durable-transaction';

export type ReplaySuppressionCounts = Readonly<Record<Exclude<ReplayEffectClass, 'pure-state'>, number>>;

export class ReplaySideEffectGate {
  private replayDepth = 0;
  private readonly suppressedCounts: Record<Exclude<ReplayEffectClass, 'pure-state'>, number> = {
    'idempotent-presentation': 0,
    'one-shot-presentation': 0,
    'authoritative-gameplay': 0,
    'durable-transaction': 0
  };

  runReplay<T>(operation: () => T): T {
    this.replayDepth++;
    try {
      return operation();
    } finally {
      this.replayDepth--;
    }
  }

  dispatch(effectClass: ReplayEffectClass, operation: () => void): boolean {
    if (this.replayDepth > 0 && effectClass !== 'pure-state') {
      this.suppressedCounts[effectClass]++;
      return false;
    }
    operation();
    return true;
  }

  replaying(): boolean {
    return this.replayDepth > 0;
  }

  suppressed(): ReplaySuppressionCounts {
    return Object.freeze({...this.suppressedCounts});
  }

  resetCounts(): void {
    for (const key of Object.keys(this.suppressedCounts) as Array<keyof ReplaySuppressionCounts>) {
      this.suppressedCounts[key] = 0;
    }
  }
}
