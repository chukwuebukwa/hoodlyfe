import {
  INTERIORS,
  STREET_SPACE_ID,
  containsPoint,
  interiorDefinition,
  type InteriorDefinition,
  type InteriorObstacle
} from '../../../shared/content/interior-catalog.ts';
import type {PlayerState} from '../../state.ts';

const WALL_INSET = 14;

export class InteriorController {
  move(player: PlayerState, moveX: number, moveY: number, radius: number): boolean {
    const interior = interiorDefinition(player.spaceId);
    if (!interior) return false;
    const nextX = player.x + moveX;
    if (this.canOccupyDefinition(interior, nextX, player.y, radius)) player.x = nextX;
    const nextY = player.y + moveY;
    if (this.canOccupyDefinition(interior, player.x, nextY, radius)) player.y = nextY;
    this.afterMove(player);
    return true;
  }

  canOccupy(spaceId: string, x: number, y: number, radius: number): boolean {
    const interior = interiorDefinition(spaceId);
    return Boolean(interior && this.canOccupyDefinition(interior, x, y, radius));
  }

  afterMove(player: PlayerState): void {
    const interior = interiorDefinition(player.spaceId);
    if (interior && containsPoint(interior.exitDoor, player.x, player.y)) {
      this.exit(player, interior);
    }
  }

  tryEnter(player: PlayerState): boolean {
    if (player.spaceId !== STREET_SPACE_ID || player.vehicleId) return false;
    const interior = INTERIORS.find((candidate) => (
      Math.hypot(
        player.x - candidate.exteriorDoor.x,
        player.y - candidate.exteriorDoor.y
      ) <= candidate.exteriorDoor.radius
    ));
    if (!interior) return false;
    player.spaceId = interior.id;
    player.x = interior.entry.x;
    player.y = interior.entry.y;
    player.angle = interior.entry.angle;
    return true;
  }

  reset(player: PlayerState): void {
    player.spaceId = STREET_SPACE_ID;
  }

  private exit(player: PlayerState, interior: InteriorDefinition): void {
    player.spaceId = STREET_SPACE_ID;
    player.x = interior.exteriorDoor.exitX;
    player.y = interior.exteriorDoor.exitY;
    player.angle = 0;
  }

  private canOccupyDefinition(
    interior: InteriorDefinition,
    x: number,
    y: number,
    radius: number
  ): boolean {
    const bounds = interior.bounds;
    if (
      x - radius < bounds.minX + WALL_INSET ||
      x + radius > bounds.maxX - WALL_INSET ||
      y - radius < bounds.minY + WALL_INSET ||
      y + radius > bounds.maxY - WALL_INSET
    ) return false;
    return interior.obstacles.every((obstacle) => !circleOverlapsRect(x, y, radius, obstacle));
  }
}

function circleOverlapsRect(
  x: number,
  y: number,
  radius: number,
  rect: InteriorObstacle
): boolean {
  const nearestX = Math.max(rect.minX, Math.min(x, rect.maxX));
  const nearestY = Math.max(rect.minY, Math.min(y, rect.maxY));
  return Math.hypot(x - nearestX, y - nearestY) < radius;
}
