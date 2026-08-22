import type {InteractionSnapshotRoom} from './interaction-snapshot-inbox.ts';
import {
  InteractionSnapshotInbox,
  type InteractionSnapshotInboxDiagnostics
} from './interaction-snapshot-inbox.ts';
import {
  DESKTOP_INTERACTION_ISLAND_BUDGET,
  InteractionIslandSelector,
  MOBILE_INTERACTION_ISLAND_BUDGET,
  type InteractionIslandSelection
} from './interaction-island-selector.ts';

export interface InteractionIslandControllerOptions {
  readonly currentServerTick: () => number;
  readonly estimatedServerTimeMs: () => number;
  readonly snapshotsEnabled: () => boolean;
  readonly selectionEnabled: () => boolean;
  readonly mobile?: boolean;
}

export interface InteractionIslandControllerSnapshot {
  readonly mode: 'off' | 'admission' | 'selection';
  readonly serverTick: number;
  readonly snapshotAgeMs: number;
  readonly bodies: number;
  readonly weightedPoints: number;
  readonly budgetPoints: number;
  readonly overflow: number;
  readonly contacts: number;
  readonly retainedContacts: number;
  readonly resetCount: number;
  readonly inbox: InteractionSnapshotInboxDiagnostics;
}

export class InteractionIslandController {
  private readonly inbox: InteractionSnapshotInbox;
  private readonly selector: InteractionIslandSelector;
  private removeSnapshotListener?: () => void;
  private selection?: InteractionIslandSelection;

  constructor(room: InteractionSnapshotRoom, private readonly options: InteractionIslandControllerOptions) {
    this.selector = new InteractionIslandSelector(options.mobile
      ? MOBILE_INTERACTION_ISLAND_BUDGET
      : DESKTOP_INTERACTION_ISLAND_BUDGET);
    this.inbox = new InteractionSnapshotInbox(room, {
      currentServerTick: options.currentServerTick,
      enabled: options.snapshotsEnabled
    });
    this.removeSnapshotListener = this.inbox.subscribe((snapshot) => {
      if (!this.options.selectionEnabled()) {
        this.selector.reset();
        this.selection = undefined;
        return;
      }
      this.selection = this.selector.select(snapshot);
    });
  }

  latestSelection(): InteractionIslandSelection | undefined {
    return this.selection;
  }

  snapshot(): InteractionIslandControllerSnapshot {
    const latest = this.inbox.latest();
    const selection = this.selection;
    return Object.freeze({
      mode: !this.options.snapshotsEnabled()
        ? 'off'
        : (this.options.selectionEnabled() ? 'selection' : 'admission'),
      serverTick: latest?.serverTick ?? -1,
      snapshotAgeMs: latest
        ? Math.max(0, Math.round((this.options.estimatedServerTimeMs() - latest.serverTimeMs) * 10) / 10)
        : 0,
      bodies: selection?.members.length ?? latest?.bodies.length ?? 0,
      weightedPoints: selection?.weightedPoints ?? 0,
      budgetPoints: selection?.budgetPoints ?? (this.options.mobile
        ? MOBILE_INTERACTION_ISLAND_BUDGET
        : DESKTOP_INTERACTION_ISLAND_BUDGET),
      overflow: selection?.overflowBodyKeys.length ?? 0,
      contacts: selection?.members.filter(({reason}) => reason === 'current-contact').length ?? 0,
      retainedContacts: selection?.members.filter(({reason}) => reason === 'contact-retained').length ?? 0,
      resetCount: selection?.resetCount ?? 0,
      inbox: this.inbox.diagnostics()
    });
  }

  destroy(): void {
    this.removeSnapshotListener?.();
    this.removeSnapshotListener = undefined;
    this.inbox.destroy();
    this.selector.reset();
    this.selection = undefined;
  }
}
