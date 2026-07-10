import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {DeterministicRandom} from './game/world/deterministic-random.ts';

const MAP_RANDOM = new DeterministicRandom('industrial-district-map:v1');

interface TileLayer {
  name: string;
  data: number[];
}

interface TiledMapData {
  width: number;
  height: number;
  tilewidth: number;
  tileheight: number;
  layers: TileLayer[];
}

interface MapMetadata {
  spawn: {x: number; y: number};
}

export interface RoadNode {
  column: number;
  row: number;
}

export interface TrafficSpawn extends RoadNode {
  x: number;
  y: number;
  angle: number;
  targetColumn: number;
  targetRow: number;
}

export class CollisionMap {
  readonly width: number;
  readonly height: number;
  readonly tileWidth: number;
  readonly tileHeight: number;
  readonly spawn: {x: number; y: number};
  private readonly collisions: number[];
  private readonly openCells: Array<{column: number; row: number}>;
  private readonly roads: number[];
  private readonly roadCells: RoadNode[];

  constructor(map: TiledMapData, metadata: MapMetadata) {
    const collisionLayer = map.layers.find((layer) => layer.name === 'collisions');
    if (!collisionLayer || collisionLayer.data.length !== map.width * map.height) {
      throw new Error('Industrial District is missing a valid collisions layer.');
    }

    this.width = map.width;
    this.height = map.height;
    this.tileWidth = map.tilewidth;
    this.tileHeight = map.tileheight;
    this.collisions = collisionLayer.data;
    const roadLayer = map.layers.find((layer) => layer.name === 'roads');
    this.roads = roadLayer?.data.length === map.width * map.height
      ? roadLayer.data
      : new Array(map.width * map.height).fill(0);
    this.spawn = metadata.spawn;
    this.openCells = [];
    this.roadCells = [];
    for (let row = 0; row < this.height; row++) {
      for (let column = 0; column < this.width; column++) {
        if (this.collisions[row * this.width + column] === 0) {
          this.openCells.push({column, row});
        }
        if (this.roads[row * this.width + column] !== 0) {
          this.roadCells.push({column, row});
        }
      }
    }
  }

  static load(projectRoot = process.cwd()): CollisionMap {
    const mapsDirectory = resolve(projectRoot, 'public', 'assets', 'maps');
    const map = JSON.parse(readFileSync(resolve(mapsDirectory, 'district-map.json'), 'utf8')) as TiledMapData;
    const metadata = JSON.parse(
      readFileSync(resolve(mapsDirectory, 'district-map.metadata.json'), 'utf8')
    ) as MapMetadata;
    return new CollisionMap(map, metadata);
  }

  isBlockedAt(x: number, y: number): boolean {
    const column = Math.floor(x / this.tileWidth);
    const row = Math.floor(y / this.tileHeight);
    if (column < 0 || row < 0 || column >= this.width || row >= this.height) {
      return true;
    }
    return this.collisions[row * this.width + column] !== 0;
  }

  canOccupy(x: number, y: number, radius: number): boolean {
    const diagonal = radius * 0.72;
    const samples = [
      [x - radius, y],
      [x + radius, y],
      [x, y - radius],
      [x, y + radius],
      [x - diagonal, y - diagonal],
      [x + diagonal, y - diagonal],
      [x - diagonal, y + diagonal],
      [x + diagonal, y + diagonal]
    ];
    return samples.every(([sampleX, sampleY]) => !this.isBlockedAt(sampleX, sampleY));
  }

  spawnFor(playerIndex: number, radius: number): {x: number; y: number} {
    const offsets = [
      [0, 0], [24, 0], [0, 24], [24, 24], [-24, 0], [0, -24], [-24, -24], [24, -24]
    ];
    for (let step = 0; step < offsets.length; step++) {
      const [offsetX, offsetY] = offsets[(playerIndex + step) % offsets.length];
      const x = this.spawn.x + offsetX;
      const y = this.spawn.y + offsetY;
      if (this.canOccupy(x, y, radius)) {
        return {x, y};
      }
    }
    return {...this.spawn};
  }

  openPoint(index: number, radius: number): {x: number; y: number} {
    if (this.openCells.length === 0) {
      return {...this.spawn};
    }
    const start = Math.abs(index * 97) % this.openCells.length;
    for (let step = 0; step < this.openCells.length; step++) {
      const cell = this.openCells[(start + step * 37) % this.openCells.length];
      const x = (cell.column + 0.5) * this.tileWidth;
      const y = (cell.row + 0.5) * this.tileHeight;
      if (this.canOccupy(x, y, radius)) {
        return {x, y};
      }
    }
    return {...this.spawn};
  }

  openPointNear(
    x: number,
    y: number,
    minDistance: number,
    maxDistance: number,
    radius: number,
    seed: number
  ): {x: number; y: number} {
    for (let attempt = 0; attempt < 96; attempt++) {
      const sample = MAP_RANDOM.unit('open-point-distance', seed + attempt * 17);
      const angle = MAP_RANDOM.unit('open-point-angle', seed + attempt * 31 + 7) * Math.PI * 2;
      const distance = minDistance + (maxDistance - minDistance) * sample;
      const candidateX = x + Math.cos(angle) * distance;
      const candidateY = y + Math.sin(angle) * distance;
      if (this.canOccupy(candidateX, candidateY, radius)) {
        return {x: candidateX, y: candidateY};
      }
    }
    return this.openPoint(seed, radius);
  }

  isRoadAt(x: number, y: number): boolean {
    return this.isRoadCell(Math.floor(x / this.tileWidth), Math.floor(y / this.tileHeight));
  }

  roadNeighbors(column: number, row: number): RoadNode[] {
    const candidates = [
      {column: column + 1, row},
      {column: column - 1, row},
      {column, row: row + 1},
      {column, row: row - 1}
    ];
    return candidates.filter((candidate) => this.isRoadCell(candidate.column, candidate.row));
  }

  trafficSpawn(index: number, radius: number): TrafficSpawn {
    if (this.roadCells.length === 0) {
      const fallback = this.openPoint(index, radius);
      return {
        ...fallback,
        column: Math.floor(fallback.x / this.tileWidth),
        row: Math.floor(fallback.y / this.tileHeight),
        angle: 0,
        targetColumn: Math.floor(fallback.x / this.tileWidth),
        targetRow: Math.floor(fallback.y / this.tileHeight)
      };
    }

    const start = Math.abs(index * 131) % this.roadCells.length;
    for (let step = 0; step < this.roadCells.length; step++) {
      const cell = this.roadCells[(start + step * 53) % this.roadCells.length];
      const x = (cell.column + 0.5) * this.tileWidth;
      const y = (cell.row + 0.5) * this.tileHeight;
      if (!this.canOccupy(x, y, radius)) continue;

      const neighbors = this.roadNeighbors(cell.column, cell.row).filter((neighbor) => {
        const neighborX = (neighbor.column + 0.5) * this.tileWidth;
        const neighborY = (neighbor.row + 0.5) * this.tileHeight;
        return this.canOccupy(neighborX, neighborY, radius);
      });
      const straight = neighbors.filter((neighbor) => {
        const oppositeColumn = cell.column - (neighbor.column - cell.column);
        const oppositeRow = cell.row - (neighbor.row - cell.row);
        return this.isRoadCell(oppositeColumn, oppositeRow);
      });
      const choices = straight.length > 0 ? straight : neighbors;
      if (choices.length === 0) continue;
      const target = choices[index % choices.length];
      return {
        x,
        y,
        column: cell.column,
        row: cell.row,
        targetColumn: target.column,
        targetRow: target.row,
        angle: Math.atan2(target.row - cell.row, target.column - cell.column)
      };
    }

    throw new Error('Industrial District does not contain a usable traffic lane.');
  }

  hasLineOfSight(fromX: number, fromY: number, toX: number, toY: number): boolean {
    const distance = Math.hypot(toX - fromX, toY - fromY);
    const steps = Math.max(1, Math.ceil(distance / 24));
    for (let step = 1; step < steps; step++) {
      const progress = step / steps;
      if (this.isBlockedAt(
        fromX + (toX - fromX) * progress,
        fromY + (toY - fromY) * progress
      )) {
        return false;
      }
    }
    return true;
  }

  private isRoadCell(column: number, row: number): boolean {
    return column >= 0 && row >= 0 && column < this.width && row < this.height &&
      this.roads[row * this.width + column] !== 0;
  }
}
