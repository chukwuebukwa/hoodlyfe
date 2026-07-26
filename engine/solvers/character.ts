/**
 * Character movement solver.
 *
 * 'axis-slide' reproduces the existing shared on-foot semantics exactly
 * (integrate desired motion, test X and Y occupancy separately, accept each
 * axis independently) so migration is behavior-preserving. 'collide-slide'
 * is the successor mode: swept circle vs the tile grid with tangential slide,
 * eliminating axis-order artifacts. Game rules (surfaces, interiors) stay
 * outside via the occupancy hook.
 */

import {finiteClamp, finite} from '../core/math';
import {circleFitsInTiles, type TileWorld} from '../world/tile-world';
import {sweptCircleVsGrid} from '../geometry/sweep';

export const CHARACTER_MAX_STEP_SECONDS = 0.05;
export const CHARACTER_DEFAULT_RADIUS = 11;
export const CHARACTER_DEFAULT_SPEED = 190;

export interface CharacterPose {
  x: number;
  y: number;
  spaceId: string;
  surfaceId?: string;
}

export interface CharacterCommand {
  moveX: number;
  moveY: number;
}

export interface CharacterModifiers {
  movementScale?: number;
  radius?: number;
  speed?: number;
}

/** Same contract as OnFootWorldOccupancy in shared/simulation/on-foot-step.ts. */
export type CharacterOccupancy = (
  spaceId: string,
  x: number,
  y: number,
  radius: number,
  surfaceId?: string,
  fromX?: number,
  fromY?: number
) => boolean | string;

export interface CharacterStepResult {
  pose: CharacterPose;
  attemptedX: number;
  attemptedY: number;
  collidedX: boolean;
  collidedY: boolean;
  distance: number;
}

/** Pure integration of intent — identical math to integrateOnFootPose. */
export function integrateCharacterPose(
  pose: CharacterPose,
  command: CharacterCommand,
  deltaSeconds: number,
  modifiers: CharacterModifiers = {}
): CharacterPose {
  const delta = finiteClamp(deltaSeconds, 0, CHARACTER_MAX_STEP_SECONDS);
  const movementScale = finiteClamp(modifiers.movementScale ?? 1, 0, 2);
  const speed = finiteClamp(modifiers.speed ?? CHARACTER_DEFAULT_SPEED, 0, 1_000);
  const inputX = finiteClamp(command.moveX, -1, 1);
  const inputY = finiteClamp(command.moveY, -1, 1);
  // Math.hypot, not sqrt(x²+y²): bit-parity with shared/simulation/on-foot-step.ts.
  const magnitude = Math.hypot(inputX, inputY);
  const normalization = magnitude > 1 ? 1 / magnitude : 1;
  const distance = speed * movementScale * delta;
  return {
    x: finite(pose.x) + inputX * normalization * distance,
    y: finite(pose.y) + inputY * normalization * distance,
    spaceId: typeof pose.spaceId === 'string' && pose.spaceId ? pose.spaceId : 'street',
    ...(pose.surfaceId ? {surfaceId: pose.surfaceId} : {}),
  };
}

/** Axis-separated slide — parity with stepInteriorOnFootPose. */
export function stepCharacterAxisSlide(
  pose: CharacterPose,
  command: CharacterCommand,
  deltaSeconds: number,
  canOccupy: CharacterOccupancy,
  modifiers: CharacterModifiers = {}
): CharacterStepResult {
  const radius = finiteClamp(modifiers.radius ?? CHARACTER_DEFAULT_RADIUS, 1, 256);
  const startX = finite(pose.x);
  const startY = finite(pose.y);
  const spaceId = typeof pose.spaceId === 'string' && pose.spaceId ? pose.spaceId : 'street';
  const attempted = integrateCharacterPose(pose, command, deltaSeconds, modifiers);
  const attemptedX = attempted.x;
  const attemptedY = attempted.y;
  const moveX = attemptedX - startX;
  const moveY = attemptedY - startY;
  let x = startX;
  let y = startY;
  let surfaceId = pose.surfaceId;
  const xOccupancy = moveX !== 0 ? canOccupy(spaceId, attemptedX, y, radius, surfaceId, x, y) : true;
  const collidedX = !xOccupancy;
  if (!collidedX) {
    x = attemptedX;
    if (typeof xOccupancy === 'string') surfaceId = xOccupancy;
  }
  const yOccupancy = moveY !== 0 ? canOccupy(spaceId, x, attemptedY, radius, surfaceId, x, y) : true;
  const collidedY = !yOccupancy;
  if (!collidedY) {
    y = attemptedY;
    if (typeof yOccupancy === 'string') surfaceId = yOccupancy;
  }
  return {
    pose: {x, y, spaceId, ...(surfaceId ? {surfaceId} : {})},
    attemptedX,
    attemptedY,
    collidedX,
    collidedY,
    distance: Math.hypot(x - startX, y - startY),
  };
}

/**
 * Swept collide-and-slide against the tile grid: sweep the circle along the
 * intent vector, advance to the first contact, cancel the motion component
 * into the wall normal, and continue with the tangential remainder (up to 3
 * iterations — enough for corners and 45° seams). Every accepted position is
 * verified with the exact circle-vs-tile fit test, so the character can never
 * end inside a wall and cannot tunnel regardless of speed × dt.
 *
 * NOTE: surface/interior game rules (the occupancy-hook string returns that
 * axis-slide supports) are intentionally not wired here yet — that
 * integration point lands with the on-foot migration, when the real
 * `surfaceAfterMove` call sites define what a non-axis-decomposed transition
 * means. Until then this mode carries `surfaceId` through unchanged.
 */
export function stepCharacterCollideSlide(
  tiles: TileWorld,
  pose: CharacterPose,
  command: CharacterCommand,
  deltaSeconds: number,
  modifiers: CharacterModifiers = {}
): CharacterStepResult {
  const radius = finiteClamp(modifiers.radius ?? CHARACTER_DEFAULT_RADIUS, 1, 256);
  const startX = finite(pose.x);
  const startY = finite(pose.y);
  const attempted = integrateCharacterPose(pose, command, deltaSeconds, modifiers);
  const attemptedX = attempted.x;
  const attemptedY = attempted.y;

  const fits = (px: number, py: number): boolean => circleFitsInTiles(tiles, px, py, radius);
  const isBlockedTileAt = (col: number, row: number): boolean =>
    col < 0 || row < 0 || col >= tiles.width || row >= tiles.height
      ? true
      : tiles.collisions[row * tiles.width + col] !== 0;

  /**
   * Furthest fraction of the motion (x,y)→(x+dx,y+dy) the circle can take,
   * found by bisection against the exact fit test. Assumes `fits(x, y)`.
   */
  const furthestFit = (px: number, py: number, dx: number, dy: number): number => {
    if (fits(px + dx, py + dy)) return 1;
    let low = 0;
    let high = 1;
    for (let i = 0; i < 16; i++) {
      const mid = (low + high) / 2;
      if (fits(px + dx * mid, py + dy * mid)) low = mid;
      else high = mid;
    }
    return low;
  };

  let x = startX;
  let y = startY;
  let remainingX = attemptedX - startX;
  let remainingY = attemptedY - startY;
  let collidedX = false;
  let collidedY = false;

  // Degenerate start (spawned overlapping a wall): don't move, don't loop.
  if (!fits(x, y)) {
    return {
      pose: {x, y, spaceId: attempted.spaceId, ...(pose.surfaceId ? {surfaceId: pose.surfaceId} : {})},
      attemptedX,
      attemptedY,
      collidedX: remainingX !== 0,
      collidedY: remainingY !== 0,
      distance: 0,
    };
  }

  for (let iteration = 0; iteration < 3; iteration++) {
    if (remainingX === 0 && remainingY === 0) break;

    // Free path? Take it all.
    if (fits(x + remainingX, y + remainingY)) {
      x += remainingX;
      y += remainingY;
      break;
    }

    // Contact normal from the swept center/edge rays (cheap, gives the wall
    // face); fall back to axis probing when the sweep sees nothing (pure
    // corner clips between rays).
    const speedScale = Math.sqrt(remainingX * remainingX + remainingY * remainingY);
    const hit =
      speedScale > 1e-12
        ? sweptCircleVsGrid(x, y, remainingX, remainingY, radius, 1, isBlockedTileAt, tiles.tileWidth, tiles.tileHeight)
        : undefined;
    let normalX = hit?.normalX ?? 0;
    let normalY = hit?.normalY ?? 0;
    if (normalX === 0 && normalY === 0) {
      // Fallback: infer the blocked axis by probing each component alone.
      const xBlocked = remainingX !== 0 && !fits(x + remainingX, y);
      const yBlocked = remainingY !== 0 && !fits(x, y + remainingY);
      normalX = xBlocked ? -Math.sign(remainingX) : 0;
      normalY = yBlocked ? -Math.sign(remainingY) : 0;
      if (normalX === 0 && normalY === 0) {
        // Corner clip: both single-axis moves fit but the diagonal doesn't.
        // Advance as far as the exact test allows, then stop.
        const t = furthestFit(x, y, remainingX, remainingY);
        x += remainingX * t;
        y += remainingY * t;
        collidedX = remainingX !== 0;
        collidedY = remainingY !== 0;
        break;
      }
    }

    // Advance to the furthest exactly-fitting point along this leg.
    const t = furthestFit(x, y, remainingX, remainingY);
    x += remainingX * t;
    y += remainingY * t;

    // Cancel the into-wall component; keep the tangential remainder.
    const leftoverX = remainingX * (1 - t);
    const leftoverY = remainingY * (1 - t);
    const intoWall = leftoverX * normalX + leftoverY * normalY;
    remainingX = leftoverX - normalX * Math.min(0, intoWall);
    remainingY = leftoverY - normalY * Math.min(0, intoWall);
    if (normalX !== 0) collidedX = true;
    if (normalY !== 0) collidedY = true;
    // Kill numeric dust so the loop terminates crisply.
    if (Math.abs(remainingX) < 1e-9) remainingX = 0;
    if (Math.abs(remainingY) < 1e-9) remainingY = 0;
  }

  return {
    pose: {x, y, spaceId: attempted.spaceId, ...(pose.surfaceId ? {surfaceId: pose.surfaceId} : {})},
    attemptedX,
    attemptedY,
    collidedX,
    collidedY,
    distance: Math.sqrt((x - startX) ** 2 + (y - startY) ** 2),
  };
}
