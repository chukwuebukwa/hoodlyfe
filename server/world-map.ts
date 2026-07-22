import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {DeterministicRandom} from './game/world/deterministic-random.ts';
import {
  STREET_GROUND_SURFACE_ID,
  SurfaceMap,
  type SurfaceActorKind,
  type SurfaceManifest
} from '../shared/world/surface-map.ts';

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
  surfaceId?: string;
}

export interface SurfacePosition {
  x: number;
  y: number;
  surfaceId: string;
}

export interface TrafficSpawn extends RoadNode {
  x: number;
  y: number;
  surfaceId?: string;
  angle: number;
  targetColumn: number;
  targetRow: number;
  laneEdgeId?: string;
  laneFromNodeId?: string;
  laneToNodeId?: string;
}

export class CollisionMap {
  readonly width: number;
  readonly height: number;
  readonly tileWidth: number;
  readonly tileHeight: number;
  readonly spawn: {x: number; y: number};
  readonly surfaces: SurfaceMap;
  private readonly collisions: number[];
  private readonly openCells: Array<{column: number; row: number}>;
  private readonly roads: number[];
  private readonly roadCells: RoadNode[];

  constructor(map: TiledMapData, metadata: MapMetadata, surfaces?: SurfaceMap) {
    const collisionLayer = map.layers.find((layer) => layer.name === 'collisions');
    if (!collisionLayer || collisionLayer.data.length !== map.width * map.height) {
      throw new Error('Industrial District is missing a valid collisions layer.');
    }

    this.width = map.width;
    this.height = map.height;
    this.tileWidth = map.tilewidth;
    this.tileHeight = map.tileheight;
    this.surfaces = surfaces ? expandDefaultSurface(map, surfaces) : new SurfaceMap(flatSurfaceManifest(map));
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
    const surfaces = new SurfaceMap(JSON.parse(
      readFileSync(resolve(mapsDirectory, 'surface-manifest.json'), 'utf8')
    ));
    return new CollisionMap(map, metadata, surfaces);
  }

  physicsGeometry(): {
    width: number;
    height: number;
    tileWidth: number;
    tileHeight: number;
    collisions: readonly number[];
  } {
    return {
      width: this.width,
      height: this.height,
      tileWidth: this.tileWidth,
      tileHeight: this.tileHeight,
      collisions: this.collisions
    };
  }

  isBlockedAt(x: number, y: number): boolean {
    const column = Math.floor(x / this.tileWidth);
    const row = Math.floor(y / this.tileHeight);
    if (column < 0 || row < 0 || column >= this.width || row >= this.height) {
      return true;
    }
    return this.collisions[row * this.width + column] !== 0;
  }

  canOccupy(
    x: number,
    y: number,
    radius: number,
    surfaceId?: string,
    actorKind: SurfaceActorKind = 'player'
  ): boolean {
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
    if (!samples.every(([sampleX, sampleY]) => !this.isBlockedAt(sampleX, sampleY))) return false;
    return surfaceId
      ? this.surfaces.canOccupy(surfaceId, x, y, radius, actorKind)
      : this.surfaces.surfaceIdsAt(x, y, actorKind).some((candidate) => (
        this.surfaces.canOccupyConnected(candidate, x, y, radius, actorKind)
      ));
  }

  heightAt(surfaceId: string, x: number, y: number): number | undefined {
    return this.surfaces.heightAt(surfaceId, x, y);
  }

  surfacesCanInteract(
    firstSurfaceId: string,
    secondSurfaceId: string,
    actorKind: SurfaceActorKind
  ): boolean {
    return firstSurfaceId === secondSurfaceId ||
      this.surfaces.neighbors(firstSurfaceId, actorKind).includes(secondSurfaceId);
  }

  actorsCanInteract(
    firstSurfaceId: string,
    firstX: number,
    firstY: number,
    secondSurfaceId: string,
    secondX: number,
    secondY: number,
    actorKind: SurfaceActorKind
  ): boolean {
    if (firstSurfaceId === secondSurfaceId) return true;
    if (!this.surfacesCanInteract(firstSurfaceId, secondSurfaceId, actorKind)) return false;
    const firstHeight = this.heightAt(firstSurfaceId, firstX, firstY);
    const secondHeight = this.heightAt(secondSurfaceId, secondX, secondY);
    return firstHeight !== undefined && secondHeight !== undefined &&
      Math.abs(firstHeight - secondHeight) <= 32;
  }

  surfaceAfterMove(
    surfaceId: string,
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    radius: number,
    actorKind: SurfaceActorKind
  ): string | undefined {
    const crossing = this.surfaces.transitionFor(
      surfaceId,
      fromX,
      fromY,
      toX,
      toY,
      actorKind
    );
    const nextSurfaceId = crossing?.surfaceId ?? surfaceId;
    return this.surfaces.canOccupyConnected(
      nextSurfaceId,
      toX,
      toY,
      radius,
      actorKind,
      (surfaceId, x, y) => (
        surfaceId !== this.surfaces.manifest.defaultSurfaceId || !this.isBlockedAt(x, y)
      )
    ) ? nextSurfaceId : undefined;
  }

  spawnFor(playerIndex: number, radius: number): SurfacePosition {
    const offsets = [
      [0, 0], [24, 0], [0, 24], [24, 24], [-24, 0], [0, -24], [-24, -24], [24, -24]
    ];
    for (let step = 0; step < offsets.length; step++) {
      const [offsetX, offsetY] = offsets[(playerIndex + step) % offsets.length];
      const x = this.spawn.x + offsetX;
      const y = this.spawn.y + offsetY;
      const surfaceId = this.spawnSurfaceAt(x, y, radius, 'player', playerIndex + step);
      if (surfaceId) {
        return {x, y, surfaceId};
      }
    }
    return {...this.spawn, surfaceId: STREET_GROUND_SURFACE_ID};
  }

  openPoint(index: number, radius: number): SurfacePosition {
    if (this.openCells.length === 0) {
      return {...this.spawn, surfaceId: STREET_GROUND_SURFACE_ID};
    }
    const start = Math.abs(index * 97) % this.openCells.length;
    for (let step = 0; step < this.openCells.length; step++) {
      const cell = this.openCells[(start + step * 37) % this.openCells.length];
      const x = (cell.column + 0.5) * this.tileWidth;
      const y = (cell.row + 0.5) * this.tileHeight;
      const surfaceId = this.spawnSurfaceAt(x, y, radius, 'player', index + step);
      if (surfaceId) {
        return {x, y, surfaceId};
      }
    }
    return {...this.spawn, surfaceId: STREET_GROUND_SURFACE_ID};
  }

  pedestrianSpawn(index: number, radius: number): SurfacePosition {
    if (this.openCells.length === 0) {
      return {...this.spawn, surfaceId: STREET_GROUND_SURFACE_ID};
    }
    const start = Math.abs(index * 97) % this.openCells.length;
    for (let step = 0; step < this.openCells.length; step++) {
      const cell = this.openCells[(start + step * 37) % this.openCells.length];
      if (this.isRoadCell(cell.column, cell.row)) continue;
      const x = (cell.column + 0.5) * this.tileWidth;
      const y = (cell.row + 0.5) * this.tileHeight;
      const surfaceId = this.spawnSurfaceAt(x, y, radius, 'pedestrian', index + step);
      if (surfaceId) {
        return {x, y, surfaceId};
      }
    }
    return this.openPoint(index, radius);
  }

  openPointNear(
    x: number,
    y: number,
    minDistance: number,
    maxDistance: number,
    radius: number,
    seed: number,
    avoidRoad = false
  ): SurfacePosition {
    for (let attempt = 0; attempt < 96; attempt++) {
      const sample = MAP_RANDOM.unit('open-point-distance', seed + attempt * 17);
      const angle = MAP_RANDOM.unit('open-point-angle', seed + attempt * 31 + 7) * Math.PI * 2;
      const distance = minDistance + (maxDistance - minDistance) * sample;
      const candidateX = x + Math.cos(angle) * distance;
      const candidateY = y + Math.sin(angle) * distance;
      const surfaceId = this.spawnSurfaceAt(
        candidateX,
        candidateY,
        radius,
        'player',
        seed + attempt
      );
      if (
        surfaceId &&
        (!avoidRoad || !this.isRoadAt(candidateX, candidateY))
      ) {
        return {x: candidateX, y: candidateY, surfaceId};
      }
    }
    return avoidRoad ? this.pedestrianSpawn(seed, radius) : this.openPoint(seed, radius);
  }

  isRoadAt(x: number, y: number): boolean {
    return this.isRoadCell(Math.floor(x / this.tileWidth), Math.floor(y / this.tileHeight));
  }

  roadNeighbors(column: number, row: number, surfaceId?: string): RoadNode[] {
    const candidates = [
      {column: column + 1, row},
      {column: column - 1, row},
      {column, row: row + 1},
      {column, row: row - 1}
    ];
    return candidates.flatMap((candidate) => {
      if (!this.isRoadCell(candidate.column, candidate.row)) return [];
      if (!surfaceId) return [candidate];
      const from = this.roadPoint({column, row, surfaceId});
      const to = this.roadPoint(candidate);
      const nextSurfaceId = this.surfaceAfterMove(
        surfaceId,
        from.x,
        from.y,
        to.x,
        to.y,
        0,
        'vehicle'
      );
      return nextSurfaceId ? [{...candidate, surfaceId: nextSurfaceId}] : [];
    });
  }

  roadPoint(node: RoadNode): SurfacePosition {
    return {
      x: (node.column + 0.5) * this.tileWidth,
      y: (node.row + 0.5) * this.tileHeight,
      surfaceId: node.surfaceId ?? STREET_GROUND_SURFACE_ID
    };
  }

  nearestRoadNode(x: number, y: number, radius: number, surfaceId?: string): RoadNode | undefined {
    let nearest: RoadNode | undefined;
    let nearestDistanceSquared = Number.POSITIVE_INFINITY;
    for (const node of this.roadCells) {
      const point = this.roadPoint(node);
      const deltaX = point.x - x;
      const deltaY = point.y - y;
      const distanceSquared = deltaX * deltaX + deltaY * deltaY;
      if (distanceSquared >= nearestDistanceSquared) continue;
      const candidateSurfaceId = surfaceId && this.canOccupy(
        point.x, point.y, radius, surfaceId, 'vehicle'
      ) ? surfaceId : (!surfaceId
          ? this.spawnSurfaceAt(point.x, point.y, radius, 'vehicle', 0)
          : undefined);
      if (!candidateSurfaceId) continue;
      nearest = {...node, surfaceId: candidateSurfaceId};
      nearestDistanceSquared = distanceSquared;
    }
    return nearest ? {...nearest} : undefined;
  }

  trafficSpawn(index: number, radius: number): TrafficSpawn {
    const normalizedIndex = Number.isFinite(index) ? Math.trunc(index) : 0;
    if (this.roadCells.length === 0) {
      const fallback = this.openPoint(normalizedIndex, radius);
      return {
        ...fallback,
        column: Math.floor(fallback.x / this.tileWidth),
        row: Math.floor(fallback.y / this.tileHeight),
        angle: 0,
        targetColumn: Math.floor(fallback.x / this.tileWidth),
        targetRow: Math.floor(fallback.y / this.tileHeight)
      };
    }

    const start = Math.abs(normalizedIndex * 131) % this.roadCells.length;
    for (let step = 0; step < this.roadCells.length; step++) {
      const cell = this.roadCells[(start + step * 53) % this.roadCells.length];
      const x = (cell.column + 0.5) * this.tileWidth;
      const y = (cell.row + 0.5) * this.tileHeight;
      const surfaceId = this.spawnSurfaceAt(x, y, radius, 'vehicle', normalizedIndex + step);
      if (!surfaceId) continue;

      const neighbors = this.roadNeighbors(cell.column, cell.row, surfaceId).filter((neighbor) => {
        const neighborX = (neighbor.column + 0.5) * this.tileWidth;
        const neighborY = (neighbor.row + 0.5) * this.tileHeight;
        return this.canOccupy(neighborX, neighborY, radius, neighbor.surfaceId, 'vehicle');
      });
      const straight = neighbors.filter((neighbor) => {
        const oppositeColumn = cell.column - (neighbor.column - cell.column);
        const oppositeRow = cell.row - (neighbor.row - cell.row);
        return this.isRoadCell(oppositeColumn, oppositeRow);
      });
      const choices = straight.length > 0 ? straight : neighbors;
      if (choices.length === 0) continue;
      const target = choices[Math.abs(normalizedIndex) % choices.length];
      return {
        x,
        y,
        surfaceId,
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

  private spawnSurfaceAt(
    x: number,
    y: number,
    radius: number,
    actorKind: SurfaceActorKind,
    index: number
  ): string | undefined {
    const candidates = this.surfaces.surfaceIdsAt(x, y, actorKind)
      .filter((surfaceId) => this.canOccupy(x, y, radius, surfaceId, actorKind));
    if (candidates.length === 0) return undefined;
    return candidates[Math.abs(Math.trunc(index)) % candidates.length];
  }
}

function flatSurfaceManifest(map: TiledMapData): SurfaceManifest {
  const width = map.width * map.tilewidth;
  const height = map.height * map.tileheight;
  return {
    version: 1,
    collisionRevision: 2,
    blockSize: Math.max(map.tilewidth, map.tileheight),
    defaultSurfaceId: STREET_GROUND_SURFACE_ID,
    surfaces: [{
      id: STREET_GROUND_SURFACE_ID,
      spaceId: 'street',
      actorKinds: ['player', 'pedestrian', 'vehicle', 'projectile', 'prop'],
      triangles: [
        {
          a: {x: 0, y: 0, z: 0},
          b: {x: width, y: 0, z: 0},
          c: {x: width, y: height, z: 0}
        },
        {
          a: {x: 0, y: 0, z: 0},
          b: {x: width, y: height, z: 0},
          c: {x: 0, y: height, z: 0}
        }
      ]
    }],
    transitions: []
  };
}

function expandDefaultSurface(map: TiledMapData, surfaces: SurfaceMap): SurfaceMap {
  const flat = flatSurfaceManifest(map);
  const manifest = surfaces.manifest;
  return new SurfaceMap({
    ...manifest,
    blockSize: flat.blockSize,
    surfaces: manifest.surfaces.map((surface) => (
      surface.id === manifest.defaultSurfaceId
        ? {...surface, triangles: flat.surfaces[0].triangles}
        : surface
    )),
    transitions: manifest.transitions.filter((transition) => (
      transition.fromSurfaceId !== manifest.defaultSurfaceId &&
      transition.toSurfaceId !== manifest.defaultSurfaceId
    ))
  });
}
