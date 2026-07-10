import {
  DEBUG_SNAPSHOT_MESSAGE,
  DEBUG_SUBSCRIBE_MESSAGE,
  DEBUG_UNSUBSCRIBE_MESSAGE,
  type DebugSnapshot
} from '../../../shared/protocol/debug.ts';

export interface DebugMessageRoom {
  onMessage<T>(type: string, callback: (message: T) => void): unknown;
  send(type: string): void;
}

interface DebugSnapshotSubscriptionOptions {
  room: DebugMessageRoom;
  onSnapshot: (snapshot: DebugSnapshot) => void;
}

export class DebugSnapshotSubscription {
  private removeMessageListener?: () => void;
  private started = false;

  constructor(private readonly options: DebugSnapshotSubscriptionOptions) {}

  start(): void {
    if (this.started) return;
    const remove = this.options.room.onMessage<DebugSnapshot>(
      DEBUG_SNAPSHOT_MESSAGE,
      this.options.onSnapshot
    );
    if (typeof remove === 'function') this.removeMessageListener = remove as () => void;
    this.started = true;
    this.options.room.send(DEBUG_SUBSCRIBE_MESSAGE);
  }

  destroy(): void {
    if (!this.started) return;
    try {
      this.options.room.send(DEBUG_UNSUBSCRIBE_MESSAGE);
    } finally {
      this.removeMessageListener?.();
      this.removeMessageListener = undefined;
      this.started = false;
    }
  }
}
