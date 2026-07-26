/**
 * Occupancy adapter: builds an on-foot occupancy hook (the exact
 * OnFootWorldOccupancy contract from shared/simulation/on-foot-step.ts) over
 * the TileWorld, with an optional game-rule hook for interiors/surfaces.
 * The circle test matches the character solver's probe pattern.
 */

import {circleFitsInTiles, type TileWorld} from '../world/tile-world';
import type {CharacterOccupancy} from '../solvers/character';

export interface OccupancyOptions {
  /**
   * Game-rule veto/override evaluated after the static test. Return false to
   * block, a string to move onto that surface, true to allow unchanged.
   */
  rule?: (spaceId: string, x: number, y: number, radius: number, surfaceId?: string, fromX?: number, fromY?: number) => boolean | string;
}

/** Exact circle-vs-blocked-tile test (not point sampling — corners count). */
export function circleFitsAt(tiles: TileWorld, x: number, y: number, radius: number): boolean {
  return circleFitsInTiles(tiles, x, y, radius);
}

export function createTileOccupancy(tiles: TileWorld, options: OccupancyOptions = {}): CharacterOccupancy {
  return (spaceId, x, y, radius, surfaceId, fromX, fromY) => {
    if (!circleFitsAt(tiles, x, y, radius)) return false;
    if (options.rule) return options.rule(spaceId, x, y, radius, surfaceId, fromX, fromY);
    return true;
  };
}
