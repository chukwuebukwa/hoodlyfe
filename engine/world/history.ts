/**
 * Tick-indexed world history: the rewind primitive that lag compensation and
 * divergence debugging build on. A fixed-capacity ring of immutable snapshots.
 */

import type {WorldState} from '../core/types';
import type {TileWorld} from './tile-world';
import type {QueryFilter, WorldRayHit} from './queries';
import {overlapShape, raycast} from './queries';
import type {PosedShape} from '../geometry/overlap';
import type {EngineBody} from '../core/types';
import {snapshotWorldState} from './snapshot';

/** 48 ticks = 800 ms at 60 Hz, matching today's combat history retention. */
export const DEFAULT_HISTORY_CAPACITY = 48;

export interface WorldHistory {
  readonly capacity: number;
  /** Ring slots indexed by tick % capacity; undefined until first filled. */
  readonly snapshots: Array<WorldState | undefined>;
  latestTick: number;
}

export function createWorldHistory(capacity = DEFAULT_HISTORY_CAPACITY): WorldHistory {
  return {capacity, snapshots: new Array<WorldState | undefined>(capacity), latestTick: -1};
}

export function recordSnapshot(history: WorldHistory, state: WorldState): void {
  const slot = state.tick % history.capacity;
  const existing = history.snapshots[slot];
  // Never let an out-of-order (older) record destroy a newer snapshot that
  // happens to share its ring slot.
  if (existing && existing.tick > state.tick) return;
  history.snapshots[slot] = snapshotWorldState(state);
  if (state.tick > history.latestTick) history.latestTick = state.tick;
}

/**
 * The stored snapshot for a tick. Returned by reference for query efficiency —
 * treat as immutable; mutating it corrupts history.
 */
export function stateAtTick(history: WorldHistory, tick: number): Readonly<WorldState> | undefined {
  if (tick < 0 || tick > history.latestTick || tick <= history.latestTick - history.capacity) {
    return undefined;
  }
  const snapshot = history.snapshots[tick % history.capacity];
  return snapshot && snapshot.tick === tick ? snapshot : undefined;
}

/** Oldest tick still resolvable, or -1 when empty. */
export function oldestAvailableTick(history: WorldHistory): number {
  if (history.latestTick < 0) return -1;
  for (let tick = Math.max(0, history.latestTick - history.capacity + 1); tick <= history.latestTick; tick++) {
    if (stateAtTick(history, tick)) return tick;
  }
  return -1;
}

export function raycastAtTick(
  tiles: TileWorld,
  history: WorldHistory,
  tick: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  filter?: QueryFilter
): WorldRayHit | undefined {
  const state = stateAtTick(history, tick);
  if (!state) return undefined;
  // A rewound query is only valid against the static geometry that existed at
  // that tick; refuse to mix a newer tile world with an older snapshot.
  if (state.staticRevision !== tiles.revision) return undefined;
  return raycast(tiles, state, ax, ay, bx, by, filter);
}

export function overlapAtTick(
  history: WorldHistory,
  tick: number,
  shape: PosedShape,
  filter?: QueryFilter
): EngineBody[] {
  const state = stateAtTick(history, tick);
  if (!state) return [];
  return overlapShape(state, shape, filter);
}
