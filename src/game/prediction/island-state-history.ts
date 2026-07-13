import {
  DEFAULT_INTERACTION_HISTORY_TICKS,
  type InteractionEntityState,
  type InteractionSnapshot,
  type RemoteIntentState
} from '../../../shared/protocol/interaction-contracts.ts';
import type {InteractionIslandSelection} from './interaction-island-selector.ts';

export interface InteractionIslandBaseline {
  readonly serverTick: number;
  readonly serverTimeMs: number;
  readonly worldCollisionRevision: number;
  readonly controlRevision: number;
  readonly controlMode: InteractionSnapshot['controlMode'];
  readonly acknowledgedLocalInputSequence: number;
  readonly confirmedEventsThrough: number;
  readonly rootId: string;
  readonly entities: readonly InteractionEntityState[];
  readonly remoteIntents: readonly RemoteIntentState[];
}

export class IslandStateHistory {
  private readonly frames: InteractionIslandBaseline[] = [];
  private readonly capacity: number;

  constructor(capacity = DEFAULT_INTERACTION_HISTORY_TICKS) {
    this.capacity = positiveInteger(capacity);
  }

  record(
    snapshot: InteractionSnapshot,
    selection: InteractionIslandSelection
  ): InteractionIslandBaseline | undefined {
    const frame = baselineFrom(snapshot, selection);
    if (!frame) return undefined;
    const latest = this.frames.at(-1);
    if (latest && frame.serverTick < latest.serverTick) return undefined;
    if (latest && (
      latest.rootId !== frame.rootId ||
      latest.worldCollisionRevision !== frame.worldCollisionRevision ||
      latest.controlRevision !== frame.controlRevision ||
      latest.controlMode !== frame.controlMode
    )) {
      this.frames.length = 0;
    }
    const existing = this.frames.findIndex(({serverTick}) => serverTick === frame.serverTick);
    if (existing >= 0) this.frames.splice(existing, 1);
    this.frames.push(frame);
    if (this.frames.length > this.capacity) {
      this.frames.splice(0, this.frames.length - this.capacity);
    }
    return frame;
  }

  at(serverTick: number): InteractionIslandBaseline | undefined {
    return this.frames.find((frame) => frame.serverTick === serverTick);
  }

  latest(): InteractionIslandBaseline | undefined {
    return this.frames.at(-1);
  }

  history(): readonly InteractionIslandBaseline[] {
    return Object.freeze([...this.frames]);
  }

  size(): number {
    return this.frames.length;
  }

  reset(): void {
    this.frames.length = 0;
  }
}

function baselineFrom(
  snapshot: InteractionSnapshot,
  selection: InteractionIslandSelection
): InteractionIslandBaseline | undefined {
  if (selection.serverTick !== snapshot.serverTick || selection.rootId !== snapshot.entities[0]?.id) {
    return undefined;
  }
  const byId = new Map(snapshot.entities.map((entity) => [entity.id, entity]));
  const selected = new Set<string>();
  const entities: InteractionEntityState[] = [];
  for (const member of selection.members) {
    if (selected.has(member.entity.id)) return undefined;
    const entity = byId.get(member.entity.id);
    if (!entity || !sameRevision(entity, member.entity)) return undefined;
    selected.add(entity.id);
    entities.push(freezeEntity(entity));
  }
  if (entities[0]?.id !== selection.rootId || entities.length !== selection.members.length) {
    return undefined;
  }
  const remoteIntents = snapshot.remoteIntents
    .filter(({entityId}) => selected.has(entityId))
    .sort((left, right) => left.entityId.localeCompare(right.entityId))
    .map((intent) => Object.freeze({...intent}));
  return Object.freeze({
    serverTick: snapshot.serverTick,
    serverTimeMs: snapshot.serverTimeMs,
    worldCollisionRevision: snapshot.worldCollisionRevision,
    controlRevision: snapshot.controlRevision,
    controlMode: snapshot.controlMode,
    acknowledgedLocalInputSequence: snapshot.acknowledgedLocalInputSequence,
    confirmedEventsThrough: snapshot.confirmedEventsThrough,
    rootId: selection.rootId,
    entities: Object.freeze(entities),
    remoteIntents: Object.freeze(remoteIntents)
  });
}

function sameRevision(left: InteractionEntityState, right: InteractionEntityState): boolean {
  return left.id === right.id && left.kind === right.kind &&
    left.lifecycleRevision === right.lifecycleRevision &&
    left.colliderRevision === right.colliderRevision;
}

function freezeEntity(entity: InteractionEntityState): InteractionEntityState {
  return Object.freeze({...entity}) as InteractionEntityState;
}

function positiveInteger(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError('Island state history capacity must be a positive safe integer.');
  }
  return value;
}
