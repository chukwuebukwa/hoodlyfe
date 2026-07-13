import type {InteractionSnapshot} from '../../../shared/protocol/interaction-contracts.ts';
import {
  InteractionIslandSelector,
  type InteractionIslandSelection
} from '../prediction/interaction-island-selector.ts';
import {
  InteractionIslandReplayController,
  type InteractionIslandReplayControllerOptions
} from '../prediction/interaction-island-replay-controller.ts';
import type {InteractionIslandReplayResult} from '../prediction/interaction-island-replay.ts';
import type {InteractionIslandBaseline} from '../prediction/island-state-history.ts';
import {
  DESKTOP_INTERACTION_ISLAND_BUDGET,
  MOBILE_INTERACTION_ISLAND_BUDGET,
  type InteractionNetworkConditions
} from '../prediction/interaction-island-policy.ts';

export interface InteractionIslandControllerOptions {
  readonly networkConditions: () => InteractionNetworkConditions;
  readonly budget?: number;
  readonly onSelection?: (selection: InteractionIslandSelection) => void;
  readonly onHistory?: (historyFrames: number) => void;
  readonly replay?: InteractionIslandReplayControllerOptions;
}

export interface InteractionSnapshotSource {
  latest(): InteractionSnapshot | undefined;
  subscribe(listener: (snapshot: InteractionSnapshot) => void): () => void;
}

export class InteractionIslandController {
  private readonly selector = new InteractionIslandSelector();
  private readonly replay: InteractionIslandReplayController;
  private readonly unsubscribe: () => void;
  private readonly budget: number;

  constructor(
    inbox: InteractionSnapshotSource,
    private readonly options: InteractionIslandControllerOptions
  ) {
    this.budget = options.budget ?? interactionIslandBudgetForEnvironment();
    this.replay = new InteractionIslandReplayController(options.replay);
    this.unsubscribe = inbox.subscribe((snapshot) => this.receive(snapshot));
    const latest = inbox.latest();
    if (latest) this.receive(latest);
  }

  latest(): InteractionIslandSelection | undefined {
    return this.selector.latest();
  }

  latestBaseline(): InteractionIslandBaseline | undefined {
    return this.replay.latestBaseline();
  }

  latestReplay(): InteractionIslandReplayResult | undefined {
    return this.replay.latestReplay();
  }

  destroy(): void {
    this.unsubscribe();
    this.selector.reset();
    this.replay.reset();
  }

  private receive(snapshot: InteractionSnapshot): void {
    const selection = this.selector.select(snapshot, {
      budget: this.budget,
      network: this.options.networkConditions()
    });
    if (!selection) return;
    this.replay.record(snapshot, selection);
    this.options.onHistory?.(this.replay.historySize());
    this.options.onSelection?.(selection);
  }
}

export function interactionIslandBudgetForEnvironment(): number {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return DESKTOP_INTERACTION_ISLAND_BUDGET;
  }
  const coarsePointer = typeof window.matchMedia === 'function' &&
    window.matchMedia('(pointer: coarse)').matches;
  const constrainedDevice = navigator.maxTouchPoints > 0 &&
    Number.isFinite(navigator.hardwareConcurrency) && navigator.hardwareConcurrency <= 8;
  return coarsePointer || constrainedDevice
    ? MOBILE_INTERACTION_ISLAND_BUDGET
    : DESKTOP_INTERACTION_ISLAND_BUDGET;
}
