/**
 * Exact segment traversal of a tile grid (Amanatides–Woo DDA). Replaces the
 * fixed-step raymarch used for bullets/LOS: visits every tile the segment
 * touches, in order, and reports the first blocked tile with an exact hit
 * point and axis-aligned face normal.
 */

import type {RayHit} from './raycast';

export function traceGrid(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  isBlocked: (col: number, row: number) => boolean,
  tileWidth: number,
  tileHeight: number
): RayHit | undefined {
  const dx = bx - ax;
  const dy = by - ay;

  let col = Math.floor(ax / tileWidth);
  let row = Math.floor(ay / tileHeight);
  const endCol = Math.floor(bx / tileWidth);
  const endRow = Math.floor(by / tileHeight);

  if (isBlocked(col, row)) {
    const inv = Math.sqrt(dx * dx + dy * dy);
    return {
      t: 0,
      x: ax,
      y: ay,
      normalX: inv > 1e-12 ? -dx / inv : 1,
      normalY: inv > 1e-12 ? -dy / inv : 0,
    };
  }

  const stepCol = dx > 0 ? 1 : dx < 0 ? -1 : 0;
  const stepRow = dy > 0 ? 1 : dy < 0 ? -1 : 0;

  // Parametric distance along the segment to the next vertical / horizontal
  // tile boundary, and per-tile increments.
  let tMaxX = Number.POSITIVE_INFINITY;
  let tDeltaX = Number.POSITIVE_INFINITY;
  if (stepCol !== 0) {
    const nextBoundary = (col + (stepCol > 0 ? 1 : 0)) * tileWidth;
    tMaxX = (nextBoundary - ax) / dx;
    tDeltaX = (tileWidth * stepCol) / dx;
  }
  let tMaxY = Number.POSITIVE_INFINITY;
  let tDeltaY = Number.POSITIVE_INFINITY;
  if (stepRow !== 0) {
    const nextBoundary = (row + (stepRow > 0 ? 1 : 0)) * tileHeight;
    tMaxY = (nextBoundary - ay) / dy;
    tDeltaY = (tileHeight * stepRow) / dy;
  }

  while (col !== endCol || row !== endRow) {
    // Exact corner crossing: the ray passes through a lattice point. Either
    // orthogonal neighbor blocks the corner, so check both before stepping
    // diagonally — otherwise forward and reverse traces disagree.
    if (tMaxX === tMaxY && stepCol !== 0 && stepRow !== 0) {
      const t = tMaxX;
      if (t > 1) return undefined;
      if (isBlocked(col + stepCol, row) || isBlocked(col, row + stepRow)) {
        const clamped = t < 0 ? 0 : t;
        const blockedX = isBlocked(col + stepCol, row);
        return {
          t: clamped,
          x: ax + dx * clamped,
          y: ay + dy * clamped,
          normalX: blockedX ? -stepCol : 0,
          normalY: blockedX ? 0 : -stepRow,
        };
      }
      col += stepCol;
      row += stepRow;
      tMaxX += tDeltaX;
      tMaxY += tDeltaY;
      if (isBlocked(col, row)) {
        const clamped = t < 0 ? 0 : t;
        return {t: clamped, x: ax + dx * clamped, y: ay + dy * clamped, normalX: -stepCol, normalY: 0};
      }
      continue;
    }
    let crossedX: boolean;
    if (tMaxX < tMaxY) {
      col += stepCol;
      crossedX = true;
    } else {
      row += stepRow;
      crossedX = false;
    }
    const t = crossedX ? tMaxX : tMaxY;
    if (crossedX) tMaxX += tDeltaX;
    else tMaxY += tDeltaY;
    if (t > 1) return undefined;

    if (isBlocked(col, row)) {
      const clamped = t < 0 ? 0 : t;
      return {
        t: clamped,
        x: ax + dx * clamped,
        y: ay + dy * clamped,
        normalX: crossedX ? -stepCol : 0,
        normalY: crossedX ? 0 : -stepRow,
      };
    }
  }
  return undefined;
}
