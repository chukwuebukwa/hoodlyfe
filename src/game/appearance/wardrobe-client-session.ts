import {
  cloneAppearance,
  type PlayerAppearance
} from '../../../shared/content/appearance-catalog.ts';
import {
  isWardrobeItemId,
  type WardrobeItemId
} from '../../../shared/content/wardrobe-catalog.ts';
import {
  APPEARANCE_RESULT_MESSAGE,
  APPEARANCE_UPDATE_MESSAGE,
  type AppearanceResultMessage,
  type AppearanceUpdateStatus
} from '../../../shared/protocol/appearance.ts';
import {
  WARDROBE_OPEN_MESSAGE,
  WARDROBE_REQUEST_MESSAGE,
  WARDROBE_STATE_MESSAGE,
  type WardrobeOpenMessage,
  type WardrobeStateMessage
} from '../../../shared/protocol/wardrobe.ts';

export interface WardrobeMessageRoom {
  onMessage<T>(type: string, callback: (message: T) => void): unknown;
  send(type: string, message?: unknown): void;
}

interface WardrobeClientSessionOptions {
  room: WardrobeMessageRoom;
  onInventory: () => void;
  onOpen: () => void;
  onApplyResult: (status: AppearanceUpdateStatus, appearance: PlayerAppearance) => void;
}

export class WardrobeClientSession {
  private readonly ownedItemIds = new Set<WardrobeItemId>();
  private pendingApply?: PlayerAppearance;
  private removeAppearanceResultListener?: () => void;
  private removeWardrobeStateListener?: () => void;
  private removeWardrobeOpenListener?: () => void;
  private started = false;

  constructor(private readonly options: WardrobeClientSessionOptions) {}

  start(): void {
    if (this.started) return;
    this.removeAppearanceResultListener = listener(
      this.options.room.onMessage<AppearanceResultMessage>(
        APPEARANCE_RESULT_MESSAGE,
        this.handleAppearanceResult
      )
    );
    this.removeWardrobeStateListener = listener(
      this.options.room.onMessage<WardrobeStateMessage>(
        WARDROBE_STATE_MESSAGE,
        this.handleWardrobeState
      )
    );
    this.removeWardrobeOpenListener = listener(
      this.options.room.onMessage<WardrobeOpenMessage>(
        WARDROBE_OPEN_MESSAGE,
        this.handleWardrobeOpen
      )
    );
    this.started = true;
    this.options.room.send(WARDROBE_REQUEST_MESSAGE);
  }

  submit(appearance: PlayerAppearance): boolean {
    if (!this.started || this.pendingApply) return false;
    this.pendingApply = cloneAppearance(appearance);
    this.options.room.send(APPEARANCE_UPDATE_MESSAGE, appearance);
    return true;
  }

  isApplying(): boolean {
    return Boolean(this.pendingApply);
  }

  ownedItems(): ReadonlySet<WardrobeItemId> {
    return this.ownedItemIds;
  }

  destroy(): void {
    this.removeAppearanceResultListener?.();
    this.removeWardrobeStateListener?.();
    this.removeWardrobeOpenListener?.();
    this.removeAppearanceResultListener = undefined;
    this.removeWardrobeStateListener = undefined;
    this.removeWardrobeOpenListener = undefined;
    this.pendingApply = undefined;
    this.ownedItemIds.clear();
    this.started = false;
  }

  private readonly handleAppearanceResult = (message: AppearanceResultMessage): void => {
    if (!this.pendingApply || !message?.status) return;
    const pending = this.pendingApply;
    this.pendingApply = undefined;
    this.options.onApplyResult(message.status, pending);
  };

  private readonly handleWardrobeState = (message: WardrobeStateMessage): void => {
    if (!message || !Array.isArray(message.ownedItemIds)) return;
    this.ownedItemIds.clear();
    for (const itemId of message.ownedItemIds) {
      if (isWardrobeItemId(itemId)) this.ownedItemIds.add(itemId);
    }
    this.options.onInventory();
  };

  private readonly handleWardrobeOpen = (message: WardrobeOpenMessage): void => {
    if (!message || typeof message.serviceId !== 'string') return;
    this.options.onOpen();
  };
}

function listener(value: unknown): (() => void) | undefined {
  return typeof value === 'function' ? value as () => void : undefined;
}
