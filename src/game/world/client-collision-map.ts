import {
  STREET_SPACE_ID,
  clientInteriorDefinition,
  type InteriorObstacle
} from '../../../shared/content/interior-catalog.ts';
import {
  SEAMLESS_COLLISION_REPLACEMENT_RECTS,
  SEAMLESS_GARAGE_DOORS,
  SEAMLESS_STATIC_RECTS,
  blocksSeamlessInterior,
  replacesSeamlessWorldCollision
} from '../../../shared/content/seamless-interior-catalog.ts';

interface TiledLayer {name: string; data: number[];}
interface TiledCollisionMap {
  width: number;
  height: number;
  tilewidth: number;
  tileheight: number;
  layers: TiledLayer[];
}

export interface ClientCollisionGrid {
  width: number;
  height: number;
  tileSize: number;
  collisions: number[];
}

const INTERIOR_WALL_INSET = 14;

export class ClientCollisionMap {
  private readonly collisions: number[];
  private readonly passableGarageDoors = new Set<string>();

  constructor(private readonly map: TiledCollisionMap) {
    const layer = map.layers.find((candidate) => candidate.name === 'collisions');
    if (!layer || layer.data.length !== map.width * map.height) {
      throw new Error('Industrial District is missing a valid client collisions layer.');
    }
    this.collisions = layer.data;
  }

  static async load(url = '/assets/maps/district-map.json'): Promise<ClientCollisionMap> {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Client collision map failed to load (${response.status}).`);
    return new ClientCollisionMap(await response.json() as TiledCollisionMap);
  }

  static fromGrid(grid: ClientCollisionGrid): ClientCollisionMap {
    return new ClientCollisionMap({
      width: grid.width,
      height: grid.height,
      tilewidth: grid.tileSize,
      tileheight: grid.tileSize,
      layers: [{name: 'collisions', data: [...grid.collisions]}]
    });
  }

  physicsGeometry(): {
    width: number;
    height: number;
    tileWidth: number;
    tileHeight: number;
    collisions: readonly number[];
    staticRects: typeof SEAMLESS_STATIC_RECTS;
    collisionExclusions: typeof SEAMLESS_COLLISION_REPLACEMENT_RECTS;
  } {
    return {
      width: this.map.width,
      height: this.map.height,
      tileWidth: this.map.tilewidth,
      tileHeight: this.map.tileheight,
      collisions: this.collisions,
      staticRects: SEAMLESS_STATIC_RECTS,
      collisionExclusions: SEAMLESS_COLLISION_REPLACEMENT_RECTS
    };
  }

  canOccupy(spaceId: string, x: number, y: number, radius: number): boolean {
    if (spaceId !== STREET_SPACE_ID) return this.canOccupyInterior(spaceId, x, y, radius);
    if (
      blocksSeamlessInterior(x, y, radius, 'player') ||
      this.blocksGarageDoor(x, y, radius)
    ) return false;
    const diagonal = radius * 0.72;
    return [
      [x - radius, y], [x + radius, y], [x, y - radius], [x, y + radius],
      [x - diagonal, y - diagonal], [x + diagonal, y - diagonal],
      [x - diagonal, y + diagonal], [x + diagonal, y + diagonal]
    ].every(([sampleX, sampleY]) => !this.isBlockedAt(sampleX, sampleY));
  }

  isBlockedAt(x: number, y: number): boolean {
    const column = Math.floor(x / this.map.tilewidth);
    const row = Math.floor(y / this.map.tileheight);
    if (column < 0 || row < 0 || column >= this.map.width || row >= this.map.height) return true;
    return (
      !replacesSeamlessWorldCollision(x, y) &&
      this.collisions[row * this.map.width + column] !== 0
    ) ||
      blocksSeamlessInterior(x, y, 0, 'player') || this.blocksGarageDoor(x, y, 0);
  }

  setGarageDoorPassable(id: string, passable: boolean): void {
    if (passable) this.passableGarageDoors.add(id);
    else this.passableGarageDoors.delete(id);
  }

  private blocksGarageDoor(x: number, y: number, radius: number): boolean {
    return SEAMLESS_GARAGE_DOORS.some((door) => {
      if (this.passableGarageDoors.has(door.id)) return false;
      const nearestX = Math.max(door.minX, Math.min(x, door.maxX));
      const nearestY = Math.max(door.minY, Math.min(y, door.maxY));
      return Math.hypot(x - nearestX, y - nearestY) < Math.max(0, radius) || (
        radius <= 0 && x >= door.minX && x <= door.maxX &&
        y >= door.minY && y <= door.maxY
      );
    });
  }

  private canOccupyInterior(spaceId: string, x: number, y: number, radius: number): boolean {
    return canOccupyClientInterior(spaceId, x, y, radius);
  }
}

export function canOccupyClientInterior(
  spaceId: string,
  x: number,
  y: number,
  radius: number
): boolean {
  const interior = clientInteriorDefinition(spaceId);
  if (!interior) return false;
  const {bounds} = interior;
    if (
      x - radius < bounds.minX + INTERIOR_WALL_INSET ||
      x + radius > bounds.maxX - INTERIOR_WALL_INSET ||
      y - radius < bounds.minY + INTERIOR_WALL_INSET ||
      y + radius > bounds.maxY - INTERIOR_WALL_INSET
  ) return false;
  return interior.obstacles.every((obstacle) => !circleOverlapsRect(x, y, radius, obstacle));
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
