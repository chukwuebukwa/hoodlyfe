import {
  DEFAULT_INTERACTION_HISTORY_TICKS,
  INTERACTION_SNAPSHOT_MESSAGE,
  validateInteractionSnapshot,
  type InteractionSnapshot,
  type InteractionSnapshotRejection
} from '../../../shared/protocol/interaction-islands.ts';
import {WORLD_COLLISION_REVISION} from '../../../shared/simulation/world-collision-revision.ts';

export interface InteractionSnapshotRoom {
  onMessage<T>(type: string, callback: (message: T) => void): unknown;
}

export interface InteractionSnapshotInboxOptions {
  readonly currentServerTick: () => number;
  readonly enabled: () => boolean;
  readonly maximumFutureTicks?: number;
}

export interface InteractionSnapshotInboxDiagnostics {
  readonly accepted: number;
  readonly latestServerTick: number;
  readonly historySize: number;
  readonly rejectionCounts: Readonly<Record<string, number>>;
}

export class InteractionSnapshotInbox {
  private readonly history: InteractionSnapshot[] = [];
  private readonly listeners = new Set<(snapshot: InteractionSnapshot) => void>();
  private readonly rejectionCounts = new Map<InteractionSnapshotRejection, number>();
  private readonly removeMessageListener?: () => void;
  private accepted = 0;

  constructor(
    room: InteractionSnapshotRoom,
    private readonly options: InteractionSnapshotInboxOptions
  ) {
    const remove = room.onMessage<unknown>(INTERACTION_SNAPSHOT_MESSAGE, this.receive);
    if (typeof remove === 'function') this.removeMessageListener = remove as () => void;
  }

  latest(): InteractionSnapshot | undefined {
    return this.history.at(-1);
  }

  snapshots(): readonly InteractionSnapshot[] {
    return Object.freeze([...this.history]);
  }

  subscribe(listener: (snapshot: InteractionSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  diagnostics(): InteractionSnapshotInboxDiagnostics {
    return Object.freeze({
      accepted: this.accepted,
      latestServerTick: this.latest()?.serverTick ?? -1,
      historySize: this.history.length,
      rejectionCounts: Object.freeze(Object.fromEntries(this.rejectionCounts))
    });
  }

  destroy(): void {
    this.removeMessageListener?.();
    this.history.length = 0;
    this.listeners.clear();
    this.rejectionCounts.clear();
  }

  private readonly receive = (message: unknown): void => {
    if (!this.options.enabled()) return;
    const validation = validateInteractionSnapshot(message, {
      currentServerTick: safeTick(this.options.currentServerTick()),
      expectedWorldCollisionRevision: WORLD_COLLISION_REVISION,
      maximumHistoryTicks: DEFAULT_INTERACTION_HISTORY_TICKS,
      maximumFutureTicks: this.options.maximumFutureTicks ?? 3
    });
    if (!validation.accepted) {
      this.rejectionCounts.set(
        validation.reason,
        (this.rejectionCounts.get(validation.reason) ?? 0) + 1
      );
      return;
    }
    const existing = this.history.findIndex(({serverTick}) => serverTick === validation.value.serverTick);
    if (existing >= 0) this.history.splice(existing, 1);
    const insertion = this.history.findIndex(({serverTick}) => serverTick > validation.value.serverTick);
    if (insertion < 0) this.history.push(validation.value);
    else this.history.splice(insertion, 0, validation.value);
    const minimumTick = (this.latest()?.serverTick ?? validation.value.serverTick) -
      DEFAULT_INTERACTION_HISTORY_TICKS + 1;
    while (this.history[0] && this.history[0].serverTick < minimumTick) this.history.shift();
    this.accepted++;
    for (const listener of this.listeners) listener(validation.value);
  };
}

function safeTick(value: number): number {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}
