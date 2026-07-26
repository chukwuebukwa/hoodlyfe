/**
 * Line-of-sight adapter: exact grid trace with an injectable blocking
 * predicate so game rules (window tiles, smoke, interiors) stay outside the
 * engine. Drop-in shaped for today's raymarch-based hasLineOfSight helpers.
 */

import {traceGrid} from '../geometry/grid-trace';
import {isBlockedTile, type TileWorld} from '../world/tile-world';

export function hasLineOfSight(
  tiles: TileWorld,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  blocking?: (col: number, row: number) => boolean
): boolean {
  // A custom predicate composes with the map bounds — out-of-bounds is always
  // opaque, so a "smoke only" predicate can't see through the world border.
  const outOfBounds = (col: number, row: number) =>
    col < 0 || row < 0 || col >= tiles.width || row >= tiles.height;
  const isBlocked = blocking
    ? (col: number, row: number) => outOfBounds(col, row) || blocking(col, row)
    : (col: number, row: number) => isBlockedTile(tiles, col, row);
  return traceGrid(ax, ay, bx, by, isBlocked, tiles.tileWidth, tiles.tileHeight) === undefined;
}
