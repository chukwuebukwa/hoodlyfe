/**
 * Lag-compensation facade over the world history: the rewind query surface
 * the netcode-v2 combat resolution will consume. Enforces the rewind cap so
 * callers cannot query further back than the compensation policy allows.
 */

import type {EngineBody} from '../core/types';
import type {PosedShape} from '../geometry/overlap';
import type {TileWorld} from '../world/tile-world';
import type {QueryFilter, WorldRayHit} from '../world/queries';
import {overlapAtTick, raycastAtTick, stateAtTick, type WorldHistory} from '../world/history';

/** 24 ticks = 400 ms: covers 200 ms rewind + max interpolation delay. */
export const DEFAULT_REWIND_CAP_TICKS = 24;

export interface LagCompensator {
  readonly history: WorldHistory;
  readonly rewindCapTicks: number;
}

export function createLagCompensator(history: WorldHistory, rewindCapTicks = DEFAULT_REWIND_CAP_TICKS): LagCompensator {
  return {history, rewindCapTicks};
}

/** Clamp a requested render tick into the legal rewind window. */
export function clampRewindTick(compensator: LagCompensator, requestedTick: number): number {
  const latest = compensator.history.latestTick;
  const floor = Math.max(0, latest - compensator.rewindCapTicks);
  const clamped = Math.min(latest, Math.max(floor, Math.floor(requestedTick)));
  return clamped;
}

export function rewoundRaycast(
  compensator: LagCompensator,
  tiles: TileWorld,
  requestedTick: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  filter?: QueryFilter
): WorldRayHit | undefined {
  return raycastAtTick(tiles, compensator.history, clampRewindTick(compensator, requestedTick), ax, ay, bx, by, filter);
}

export function rewoundOverlap(
  compensator: LagCompensator,
  requestedTick: number,
  shape: PosedShape,
  filter?: QueryFilter
): EngineBody[] {
  return overlapAtTick(compensator.history, clampRewindTick(compensator, requestedTick), shape, filter);
}

export function rewindAvailable(compensator: LagCompensator, requestedTick: number): boolean {
  return stateAtTick(compensator.history, clampRewindTick(compensator, requestedTick)) !== undefined;
}
