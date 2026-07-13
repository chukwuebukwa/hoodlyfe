import {
  DEFAULT_INTERACTION_HISTORY_TICKS,
  INTERACTION_SNAPSHOT_MESSAGE,
  type InteractionProtocolRejection,
  type InteractionSnapshot
} from '../../../shared/protocol/interaction-contracts.ts';
import {validateInteractionSnapshot} from '../../../shared/protocol/interaction-snapshot-validation.ts';

export interface InteractionSnapshotMessageRoom {
  onMessage<T>(type: string, callback: (message: T) => void): unknown;
}

export interface InteractionSnapshotInboxOptions {
  currentServerTick: () => number;
  worldCollisionRevision: number;
  historyTicks?: number;
  maximumFutureTicks?: number;
}

export const MAX_INTERACTION_SNAPSHOT_LEAD_TICKS = 3;

export class InteractionSnapshotInbox {
  private readonly snapshots: InteractionSnapshot[] = [];
  private readonly listeners = new Set<(snapshot: InteractionSnapshot) => void>();
  private readonly rejectionCounts = new Map<InteractionProtocolRejection, number>();
  private readonly historyTicks: number;
  private readonly maximumFutureTicks: number;
  private removeMessageListener?: () => void;

  constructor(
    room: InteractionSnapshotMessageRoom,
    private readonly options: InteractionSnapshotInboxOptions
  ) {
    this.historyTicks = positiveInteger(
      options.historyTicks ?? DEFAULT_INTERACTION_HISTORY_TICKS,
      'Interaction snapshot history'
    );
    this.maximumFutureTicks = nonnegativeSafeInteger(
      options.maximumFutureTicks ?? MAX_INTERACTION_SNAPSHOT_LEAD_TICKS,
      'Interaction snapshot future-tick allowance'
    );
    positiveInteger(options.worldCollisionRevision, 'World collision revision');
    const remove = room.onMessage<unknown>(INTERACTION_SNAPSHOT_MESSAGE, this.receive);
    if (typeof remove === 'function') this.removeMessageListener = remove as () => void;
  }

  latest(): InteractionSnapshot | undefined {
    return this.snapshots.at(-1);
  }

  at(serverTick: number): InteractionSnapshot | undefined {
    return this.snapshots.find((snapshot) => snapshot.serverTick === serverTick);
  }

  history(): readonly InteractionSnapshot[] {
    return Object.freeze([...this.snapshots]);
  }

  rejections(): ReadonlyMap<InteractionProtocolRejection, number> {
    return new Map(this.rejectionCounts);
  }

  subscribe(listener: (snapshot: InteractionSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  destroy(): void {
    this.removeMessageListener?.();
    this.removeMessageListener = undefined;
    this.snapshots.length = 0;
    this.listeners.clear();
    this.rejectionCounts.clear();
  }

  private readonly receive = (message: unknown): void => {
    const result = validateInteractionSnapshot(message, {
      currentServerTick: nonnegativeInteger(this.options.currentServerTick()),
      expectedWorldCollisionRevision: this.options.worldCollisionRevision,
      maximumHistoryTicks: this.historyTicks,
      maximumFutureTicks: this.maximumFutureTicks
    });
    if (!result.accepted) {
      this.rejectionCounts.set(result.reason, (this.rejectionCounts.get(result.reason) ?? 0) + 1);
      return;
    }
    const existingIndex = this.snapshots.findIndex(
      (snapshot) => snapshot.serverTick === result.value.serverTick
    );
    if (existingIndex >= 0) this.snapshots.splice(existingIndex, 1);
    const insertionIndex = this.snapshots.findIndex(
      (snapshot) => snapshot.serverTick > result.value.serverTick
    );
    if (insertionIndex < 0) this.snapshots.push(result.value);
    else this.snapshots.splice(insertionIndex, 0, result.value);
    const minimumTick = (this.snapshots.at(-1)?.serverTick ?? result.value.serverTick) -
      this.historyTicks + 1;
    while (this.snapshots[0] && this.snapshots[0].serverTick < minimumTick) {
      this.snapshots.shift();
    }
    for (const listener of this.listeners) listener(result.value);
  };
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive safe integer.`);
  }
  return value;
}

function nonnegativeSafeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a nonnegative safe integer.`);
  }
  return value;
}

function nonnegativeInteger(value: number): number {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}
