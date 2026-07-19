import type {
  InteractionEntityState,
  InteractionSnapshot
} from '../../../shared/protocol/interaction-contracts.ts';
import type {InteractionIslandSelection} from './interaction-island-selector.ts';
import {
  replayInteractionIsland,
  type InteractionIslandReplayResult,
  type InteractionReplayBatchStep,
  type InteractionReplayBodyStep,
  type InteractionReplayCommand,
  type InteractionReplayPairStep
} from './interaction-island-replay.ts';
import {IslandStateHistory, type InteractionIslandBaseline} from './island-state-history.ts';

export interface InteractionReplayPreparation {
  readonly targetServerTick: number;
  readonly localCommands?: readonly InteractionReplayCommand[];
}

export interface InteractionIslandReplayControllerOptions {
  readonly currentServerTick?: () => number;
  readonly prepare?: (
    baseline: InteractionIslandBaseline
  ) => InteractionReplayPreparation | undefined;
  readonly worldCollisionRevision: () => number;
  readonly currentEntities?: () => readonly InteractionEntityState[] | undefined;
  readonly localCommands?: (
    baseline: InteractionIslandBaseline,
    targetServerTick: number
  ) => readonly InteractionReplayCommand[];
  readonly stepBody: InteractionReplayBodyStep;
  readonly stepBatch?: InteractionReplayBatchStep;
  readonly resolvePair?: InteractionReplayPairStep;
  readonly onReplay?: (
    result: InteractionIslandReplayResult,
    durationMs: number,
    baseline: InteractionIslandBaseline
  ) => void;
  readonly now?: () => number;
}

export class InteractionIslandReplayController {
  private readonly history = new IslandStateHistory();
  private latestResult?: InteractionIslandReplayResult;

  constructor(private readonly options?: InteractionIslandReplayControllerOptions) {
    if (options && !options.prepare && !options.currentServerTick) {
      throw new TypeError('Interaction replay requires a tick source or preparation callback.');
    }
  }

  record(
    snapshot: InteractionSnapshot,
    selection: InteractionIslandSelection
  ): InteractionIslandBaseline | undefined {
    const baseline = this.history.record(snapshot, selection);
    if (!baseline || !this.options) return baseline;
    const prepared = this.options.prepare?.(baseline);
    if (this.options.prepare && !prepared) return baseline;
    const targetServerTick = prepared?.targetServerTick ?? this.options.currentServerTick!();
    const start = (this.options.now ?? defaultNow)();
    this.latestResult = replayInteractionIsland({
      baseline,
      targetServerTick,
      expectedWorldCollisionRevision: this.options.worldCollisionRevision(),
      currentEntities: this.options.currentEntities?.(),
      localCommands: prepared?.localCommands ??
        this.options.localCommands?.(baseline, targetServerTick),
      stepBody: this.options.stepBody,
      stepBatch: this.options.stepBatch,
      resolvePair: this.options.resolvePair
    });
    const durationMs = Math.max(0, (this.options.now ?? defaultNow)() - start);
    this.options.onReplay?.(this.latestResult, durationMs, baseline);
    return baseline;
  }

  latestBaseline(): InteractionIslandBaseline | undefined {
    return this.history.latest();
  }

  latestReplay(): InteractionIslandReplayResult | undefined {
    return this.latestResult;
  }

  historySize(): number {
    return this.history.size();
  }

  reset(): void {
    this.history.reset();
    this.latestResult = undefined;
  }
}

function defaultNow(): number {
  return typeof performance === 'undefined' ? 0 : performance.now();
}
