import {
  DEBUG_SNAPSHOT_MESSAGE,
  type DebugEventEntry,
  type DebugPedestrianAiEntry,
  type DebugSnapshot,
  type DebugStimulusEntry
} from '../../../shared/protocol/debug.ts';
import type {DistrictState} from '../../state.ts';
import type {GameEvent} from '../events/game-events.ts';
import type {Incident} from '../incidents/incident-registry.ts';
import type {PursuitRecord} from '../police/pursuit-memory.ts';

interface DebugClock {
  tick: number;
  nowMs: number;
  droppedMs: number;
}

interface DebugSnapshotControllerOptions {
  enabled: boolean;
  state: DistrictState;
  clock: () => DebugClock;
  spatialSize: () => number;
  deferredSize: () => number;
  incidents: () => readonly Incident[];
  pursuits: () => readonly PursuitRecord[];
  pedestrians?: () => ReadonlyArray<DebugPedestrianAiEntry>;
  stimuli?: () => ReadonlyArray<DebugStimulusEntry>;
  publish: (messageType: string, snapshot: DebugSnapshot) => void;
  intervalTicks?: number;
  historyLimit?: number;
}

export class DebugSnapshotController {
  private readonly recentEvents: DebugEventEntry[] = [];
  private readonly intervalTicks: number;
  private readonly historyLimit: number;
  private lastBroadcastTick = 0;

  constructor(private readonly options: DebugSnapshotControllerOptions) {
    this.intervalTicks = positiveInteger(options.intervalTicks ?? 6, 'Debug interval');
    this.historyLimit = positiveInteger(options.historyLimit ?? 8, 'Debug history limit');
  }

  update(events: readonly GameEvent[]): void {
    if (!this.options.enabled) return;
    this.capture(events);
    const clock = this.options.clock();
    if (clock.tick - this.lastBroadcastTick < this.intervalTicks) return;
    this.lastBroadcastTick = clock.tick;
    this.options.publish(DEBUG_SNAPSHOT_MESSAGE, this.snapshot(events.length, clock));
  }

  private capture(events: readonly GameEvent[]): void {
    for (const event of events) {
      this.recentEvents.push({
        tick: event.tick,
        type: event.type,
        summary: summarizeGameEvent(event)
      });
    }
    if (this.recentEvents.length > this.historyLimit) {
      this.recentEvents.splice(0, this.recentEvents.length - this.historyLimit);
    }
  }

  private snapshot(eventsThisTick: number, clock: DebugClock): DebugSnapshot {
    const {state} = this.options;
    return {
      tick: clock.tick,
      nowMs: clock.nowMs,
      droppedMs: clock.droppedMs,
      spatialEntities: this.options.spatialSize(),
      deferredCommands: this.options.deferredSize(),
      eventsThisTick,
      players: state.players.size,
      npcs: state.npcs.size,
      vehicles: state.vehicles.size,
      bullets: state.bullets.size,
      incidents: this.options.incidents().map((incident) => ({
        id: incident.id,
        kind: incident.kind,
        suspectId: incident.suspectId,
        witnessId: incident.witnessId,
        status: incident.status,
        x: incident.x,
        y: incident.y
      })),
      pursuits: this.options.pursuits().map((pursuit) => ({
        officerId: pursuit.officerId,
        suspectId: pursuit.suspectId,
        lastKnownX: pursuit.lastKnownX,
        lastKnownY: pursuit.lastKnownY,
        mode: pursuit.mode
      })),
      pedestrianAi: (this.options.pedestrians?.() ?? []).map((pedestrian) => ({...pedestrian})),
      stimuli: (this.options.stimuli?.() ?? []).map((stimulus) => ({...stimulus})),
      events: this.recentEvents.map((event) => ({...event}))
    };
  }
}

export function summarizeGameEvent(event: GameEvent): string {
  switch (event.type) {
    case 'weapon.fired':
      return `${event.ownerKind}:${event.ownerId} fired ${event.weapon}`;
    case 'damage.applied':
      return `${event.attackerId || 'world'} -> ${event.targetKind}:${event.targetId} -${event.amount}`;
    case 'entity.killed':
      return `${event.entityKind}:${event.entityId} killed by ${event.attackerId || 'world'}`;
    case 'crime.committed':
      return `${event.suspectId} committed ${event.crimeKind} (${event.incidentId})`;
    case 'incident.reported':
      return `${event.witnessId} reported ${event.suspectId} => heat ${event.wantedLevel}`;
    case 'pursuit.changed':
      return event.suspectId
        ? `${event.officerId} dispatched to ${event.suspectId}`
        : `${event.officerId} cleared from ${event.previousSuspectId}`;
    case 'vehicle.damaged':
      return `${event.vehicleId} -${event.amount} hp (${event.sourceKind})`;
    case 'vehicle.ignited':
      return `${event.vehicleId} ignited; explosion fuse armed`;
    case 'vehicle.destroyed':
      return `${event.vehicleId} destroyed by ${event.sourceId || event.sourceKind}`;
    case 'vehicle.restored':
      return `${event.vehicleId} restored to ${event.health} hp`;
    case 'player.respawned':
      return `${event.playerId} respawned`;
    case 'mission.phase-changed':
      return `${event.missionId} ${event.previousPhase} -> ${event.phase}`;
    case 'mission.payout':
      return `${event.missionId} paid ${event.playerId} $${event.amount}`;
    case 'mission.failed':
      return `${event.missionId} failed: ${event.reason}`;
  }
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive integer.`);
  }
  return value;
}
