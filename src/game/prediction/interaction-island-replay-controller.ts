import type {
  InteractionEntityState,
  InteractionSnapshot
} from '../../../shared/protocol/interaction-contracts.ts';
import type {InteractionIslandSelection} from './interaction-island-selector.ts';
import {
  replayInteractionIsland,
  type InteractionIslandReplayResult,
  type InteractionReplayBodyStep,
  type InteractionReplayCommand,
  type InteractionReplayPairStep
} from './interaction-island-replay.ts';
import {IslandStateHistory, type InteractionIslandBaseline} from './island-state-history.ts';

export interface InteractionIslandReplayControllerOptions {
  readonly currentServerTick: () => number;
  readonly worldCollisionRevision: () => number;
  readonly currentEntities?: () => readonly InteractionEntityState[] | undefined;
  readonly localCommands?: (
    baseline: InteractionIslandBaseline,
    targetServerTick: number
  ) => readonly InteractionReplayCommand[];
  readonly stepBody: InteractionReplayBodyStep;
  readonly resolvePair?: InteractionReplayPairStep;
  readonly onReplay?: (result: InteractionIslandReplayResult, durationMs: number) => void;
  readonly now?: () => number;
}

export class InteractionIslandReplayController {
  private readonly history = new IslandStateHistory();
  private latestResult?: InteractionIslandReplayResult;

  constructor(private readonly options?: InteractionIslandReplayControllerOptions) {}

  record(
    snapshot: InteractionSnapshot,
    selection: InteractionIslandSelection
  ): InteractionIslandBaseline | undefined {
    const baseline = this.history.record(snapshot, selection);
    if (!baseline || !this.options) return baseline;
    const targetServerTick = this.options.currentServerTick();
    const start = (this.options.now ?? defaultNow)();
    this.latestResult = replayInteractionIsland({
      baseline,
      targetServerTick,
      expectedWorldCollisionRevision: this.options.worldCollisionRevision(),
      currentEntities: this.options.currentEntities?.(),
      localCommands: this.options.localCommands?.(baseline, targetServerTick),
      stepBody: this.options.stepBody,
      resolvePair: this.options.resolvePair
    });
    const durationMs = Math.max(0, (this.options.now ?? defaultNow)() - start);
    this.options.onReplay?.(this.latestResult, durationMs);
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
