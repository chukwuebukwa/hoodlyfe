import type {InteractionSnapshot} from '../../../shared/protocol/interaction-islands.ts';
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
import type {
  VehicleInteractionReplayObservation,
  VehicleInteractionReplayReason
} from './vehicle-interaction-replay.ts';

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
  readonly vehicleReplay?: InteractionIslandVehicleReplaySnapshot;
}

export interface InteractionIslandVehicleReplaySnapshot {
  readonly active: boolean;
  readonly reason: VehicleInteractionReplayReason;
  readonly serverTick: number;
  readonly replayTicks: number;
  readonly vehicleBodies: number;
  readonly contacts: number;
  readonly correctionErrorPx: number;
  readonly angularErrorRad: number;
  readonly surfaceRejects: number;
}

export interface InteractionIslandReplaySource {
  readonly snapshot: InteractionSnapshot;
  readonly selection: InteractionIslandSelection;
}

export class InteractionIslandController {
  private readonly inbox: InteractionSnapshotInbox;
  private readonly selector: InteractionIslandSelector;
  private removeSnapshotListener?: () => void;
  private selection?: InteractionIslandSelection;
  private vehicleReplay?: InteractionIslandVehicleReplaySnapshot;

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

  latestReplaySource(): InteractionIslandReplaySource | undefined {
    const snapshot = this.inbox.latest();
    const selection = this.selection;
    if (
      !snapshot || !selection ||
      selection.serverTick !== snapshot.serverTick ||
      selection.rootBodyKey !== snapshot.rootBodyKey
    ) return undefined;
    return Object.freeze({snapshot, selection});
  }

  observeVehicleReplay(observation: VehicleInteractionReplayObservation | undefined): void {
    this.vehicleReplay = observation ? vehicleReplaySnapshot(observation) : undefined;
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
      inbox: this.inbox.diagnostics(),
      ...(this.vehicleReplay ? {vehicleReplay: this.vehicleReplay} : {})
    });
  }

  destroy(): void {
    this.removeSnapshotListener?.();
    this.removeSnapshotListener = undefined;
    this.inbox.destroy();
    this.selector.reset();
    this.selection = undefined;
    this.vehicleReplay = undefined;
  }
}

function vehicleReplaySnapshot(
  observation: VehicleInteractionReplayObservation
): InteractionIslandVehicleReplaySnapshot {
  return Object.freeze({
    active: observation.active,
    reason: observation.reason,
    serverTick: observation.serverTick,
    replayTicks: observation.replayTicks,
    vehicleBodies: observation.vehicleBodies,
    contacts: observation.contacts,
    correctionErrorPx: observation.correctionErrorPx,
    angularErrorRad: observation.angularErrorRad,
    surfaceRejects: observation.surfaceRejects
  });
}
