import {
  STREET_SPACE_ID,
  clientInteriorDefinition,
  type InteriorObstacle
} from '../../../shared/content/interior-catalog.ts';

interface TiledLayer {name: string; data: number[];}
interface TiledCollisionMap {
  width: number;
  height: number;
  tilewidth: number;
  tileheight: number;
  layers: TiledLayer[];
}

const INTERIOR_WALL_INSET = 14;

export class ClientCollisionMap {
  private readonly collisions: number[];

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

  physicsGeometry(): {
    width: number;
    height: number;
    tileWidth: number;
    tileHeight: number;
    collisions: readonly number[];
  } {
    return {
      width: this.map.width,
      height: this.map.height,
      tileWidth: this.map.tilewidth,
      tileHeight: this.map.tileheight,
      collisions: this.collisions
    };
  }

  canOccupy(spaceId: string, x: number, y: number, radius: number): boolean {
    if (spaceId !== STREET_SPACE_ID) return this.canOccupyInterior(spaceId, x, y, radius);
    const diagonal = radius * 0.72;
    return [
      [x - radius, y], [x + radius, y], [x, y - radius], [x, y + radius],
      [x - diagonal, y - diagonal], [x + diagonal, y - diagonal],
      [x - diagonal, y + diagonal], [x + diagonal, y + diagonal]
    ].every(([sampleX, sampleY]) => !this.isBlockedAt(sampleX, sampleY));
  }

  private isBlockedAt(x: number, y: number): boolean {
    const column = Math.floor(x / this.map.tilewidth);
    const row = Math.floor(y / this.map.tileheight);
    if (column < 0 || row < 0 || column >= this.map.width || row >= this.map.height) return true;
    return this.collisions[row * this.map.width + column] !== 0;
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
