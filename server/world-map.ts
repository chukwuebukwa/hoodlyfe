import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {DeterministicRandom} from './game/world/deterministic-random.ts';
import type {PhysicsWorldGeometry} from '../shared/physics/physics-world.ts';
import {
  STREET_GROUND_SURFACE_ID,
  SurfaceMap,
  type SurfaceActorKind,
  type SurfaceDefinition,
  type SurfaceLanding,
  type SurfaceManifest
} from '../shared/world/surface-map.ts';
import {
  DEFAULT_SEAMLESS_INTERIOR_CATALOG,
  type SeamlessInteriorCatalog,
  type SeamlessInteriorDefinition
} from '../shared/content/seamless-interior-catalog.ts';

const MAP_RANDOM = new DeterministicRandom('industrial-district-map:v1');

interface TileLayer {
  name: string;
  data: number[];
}

interface SeamlessSurfaceGeometry {
  staticRects: Array<{minX: number; minY: number; maxX: number; maxY: number}>;
  collisionExclusions: Array<{minX: number; minY: number; maxX: number; maxY: number}>;
  garageDoors: Array<{
    id: string;
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  }>;
}

export interface TiledMapData {
  width: number;
  height: number;
  tilewidth: number;
  tileheight: number;
  layers: TileLayer[];
}

export interface MapMetadata {
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
  private readonly authoredSurfaces: boolean;
  private readonly collisions: number[];
  private readonly openCells: Array<{column: number; row: number}>;
  private readonly physicsGeometryBySurface = new Map<string, PhysicsWorldGeometry>();
  private readonly seamlessGeometryBySurface = new Map<string, SeamlessSurfaceGeometry>();
  private readonly roads: number[];
  private readonly roadCells: RoadNode[];
  private readonly passableGarageDoors = new Set<string>();

  constructor(
    map: TiledMapData,
    metadata: MapMetadata,
    surfaces?: SurfaceMap,
    readonly seamlessInteriors: SeamlessInteriorCatalog = DEFAULT_SEAMLESS_INTERIOR_CATALOG
  ) {
    const collisionLayer = map.layers.find((layer) => layer.name === 'collisions');
    if (!collisionLayer || collisionLayer.data.length !== map.width * map.height) {
      throw new Error('Industrial District is missing a valid collisions layer.');
    }

    this.width = map.width;
    this.height = map.height;
    this.tileWidth = map.tilewidth;
    this.tileHeight = map.tileheight;
    this.authoredSurfaces = Boolean(surfaces);
    this.surfaces = surfaces ?? new SurfaceMap(flatSurfaceManifest(map));
    if (this.authoredSurfaces) this.indexSeamlessSurfaceGeometry();
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
    return CollisionMap.loadFromMapsDirectory(mapsDirectory);
  }

  static loadFromMapsDirectory(mapsDirectory: string): CollisionMap {
    const map = JSON.parse(readFileSync(resolve(mapsDirectory, 'district-map.json'), 'utf8')) as TiledMapData;
    const metadata = JSON.parse(
      readFileSync(resolve(mapsDirectory, 'district-map.metadata.json'), 'utf8')
    ) as MapMetadata;
    const surfaces = new SurfaceMap(JSON.parse(
      readFileSync(resolve(mapsDirectory, 'surface-manifest.json'), 'utf8')
    ));
    return new CollisionMap(map, metadata, surfaces);
  }

  physicsGeometry(surfaceId?: string): PhysicsWorldGeometry {
    if (!this.authoredSurfaces || !surfaceId) return {
      width: this.width,
      height: this.height,
      tileWidth: this.tileWidth,
      tileHeight: this.tileHeight,
      collisions: this.collisions,
      staticRects: this.seamlessInteriors.staticRects,
      collisionExclusions: this.seamlessInteriors.collisionReplacementRects,
      controlledStaticRects: this.seamlessInteriors.garageDoors
    };
    const existing = this.physicsGeometryBySurface.get(surfaceId);
    if (existing) return existing;
    const surface = this.surfaces.surface(surfaceId);
    if (!surface) throw new Error(`Unknown physics surface "${surfaceId}".`);
    const surfaceGeometry = surfacePhysicsGeometry(
      surface,
      this.surfaces.manifest,
      this.surfaces,
      Math.max(16, Math.min(this.tileWidth, this.tileHeight) / 2)
    );
    const seamless = this.seamlessGeometryBySurface.get(surfaceId);
    const geometry = seamless
      ? Object.freeze({
        ...surfaceGeometry,
        staticRects: seamless.staticRects,
        collisionExclusions: seamless.collisionExclusions,
        controlledStaticRects: seamless.garageDoors
      })
      : surfaceGeometry;
    this.physicsGeometryBySurface.set(surfaceId, geometry);
    return geometry;
  }

  setGarageDoorPassable(id: string, passable: boolean): void {
    if (passable) this.passableGarageDoors.add(id);
    else this.passableGarageDoors.delete(id);
  }

  isBlockedAt(
    x: number,
    y: number,
    surfaceId?: string,
    actorKind: SurfaceActorKind = 'projectile'
  ): boolean {
    const seamlessCollision = (
      !surfaceId || this.seamlessGeometryBySurface.has(surfaceId)
    ) && (
      this.seamlessInteriors.blocks(x, y, 0, actorKind) || this.blocksGarageDoor(x, y, 0)
    );
    if (seamlessCollision) return true;
    if (
      surfaceId !== undefined && this.seamlessGeometryBySurface.has(surfaceId) &&
      this.seamlessInteriors.replacesWorldCollision(x, y)
    ) return false;
    if (this.authoredSurfaces && surfaceId) {
      return !this.surfaces.canOccupy(surfaceId, x, y, 0, actorKind);
    }
    const column = Math.floor(x / this.tileWidth);
    const row = Math.floor(y / this.tileHeight);
    if (column < 0 || row < 0 || column >= this.width || row >= this.height) {
      return true;
    }
    return (
      !this.seamlessInteriors.replacesWorldCollision(x, y) &&
      this.collisions[row * this.width + column] !== 0
    );
  }

  canOccupy(
    x: number,
    y: number,
    radius: number,
    surfaceId?: string,
    actorKind: SurfaceActorKind = 'player'
  ): boolean {
    if (
      (!surfaceId || this.seamlessGeometryBySurface.has(surfaceId)) &&
      (
        this.seamlessInteriors.blocks(x, y, radius, actorKind) ||
        this.blocksGarageDoor(x, y, radius)
      )
    ) return false;
    const legacyProjectionAllows = this.legacyProjectionCanOccupy(x, y, radius);
    if (!surfaceId) return legacyProjectionAllows;
    if (
      this.seamlessGeometryBySurface.has(surfaceId) &&
      this.seamlessInteriors.replacesWorldCollision(x, y)
    ) return legacyProjectionAllows;
    if (!this.authoredSurfaces && !legacyProjectionAllows) return false;
    return this.surfaces.canOccupyConnected(surfaceId, x, y, radius, actorKind);
  }

  private blocksGarageDoor(x: number, y: number, radius: number): boolean {
    return this.seamlessInteriors.garageDoors.some((door) => (
      !this.passableGarageDoors.has(door.id) && circleOverlapsRect(x, y, radius, door)
    ));
  }

  private indexSeamlessSurfaceGeometry(): void {
    for (const interior of this.seamlessInteriors.interiors) {
      const surfaceId = this.seamlessFloorSurface(interior);
      if (!surfaceId) continue;
      const current = this.seamlessGeometryBySurface.get(surfaceId) ?? {
        staticRects: [],
        collisionExclusions: [],
        garageDoors: []
      };
      current.staticRects.push(...interior.obstacles.map((obstacle) => ({
        minX: obstacle.minX,
        minY: obstacle.minY,
        maxX: obstacle.maxX,
        maxY: obstacle.maxY
      })));
      current.collisionExclusions.push(
        ...interior.footprints,
        ...interior.floorConnectors,
        entranceCollisionRect(interior.entrance)
      );
      if (interior.garageDoor) current.garageDoors.push(interior.garageDoor);
      this.seamlessGeometryBySurface.set(surfaceId, current);
    }
  }

  private seamlessFloorSurface(interior: SeamlessInteriorDefinition): string | undefined {
    const outward = entranceOutwardVector(interior.entrance.side);
    const sampleDistance = Math.max(48, (interior.garageDoor?.thickness ?? 0) + 24);
    const x = interior.entrance.x + outward.x * sampleDistance;
    const y = interior.entrance.y + outward.y * sampleDistance;
    return this.surfaces.surfaceIdsAt(x, y, 'player').find((surfaceId) => {
      const height = this.surfaces.heightAt(surfaceId, x, y);
      return height !== undefined && Math.abs(height - interior.floorZ) <= 1;
    });
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
    if (
      nextSurfaceId === this.surfaces.manifest.defaultSurfaceId &&
      this.seamlessInteriors.replacesWorldCollision(toX, toY)
    ) {
      return this.canOccupy(toX, toY, radius, nextSurfaceId, actorKind)
        ? nextSurfaceId
        : undefined;
    }
    const sampleAllowed = this.authoredSurfaces
      ? undefined
      : (sampleSurfaceId: string, x: number, y: number) => (
        sampleSurfaceId !== this.surfaces.manifest.defaultSurfaceId || !this.isBlockedAt(x, y)
      );
    return this.surfaces.canOccupyConnected(
      nextSurfaceId,
      toX,
      toY,
      radius,
      actorKind,
      sampleAllowed
    ) ? nextSurfaceId : undefined;
  }

  dropTargetAfterMove(
    surfaceId: string,
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    radius: number,
    actorKind: SurfaceActorKind
  ): SurfaceLanding | undefined {
    const takeoffHeight = this.heightAt(surfaceId, fromX, fromY);
    const distance = Math.hypot(toX - fromX, toY - fromY);
    if (takeoffHeight === undefined || distance <= 1e-6) return undefined;
    const directionX = (toX - fromX) / distance;
    const directionY = (toY - fromY) / distance;
    const probeDistance = Math.max(1, radius);
    const leadingX = toX + directionX * probeDistance;
    const leadingY = toY + directionY * probeDistance;
    if (this.heightAt(surfaceId, leadingX, leadingY) !== undefined) return undefined;
    return this.landingBelow(
      surfaceId,
      toX,
      toY,
      radius,
      actorKind,
      takeoffHeight
    ) ?? this.landingBelow(
      surfaceId,
      leadingX,
      leadingY,
      0,
      actorKind,
      takeoffHeight
    );
  }

  landingBelow(
    excludedSurfaceId: string,
    x: number,
    y: number,
    radius: number,
    actorKind: SurfaceActorKind,
    belowHeight: number
  ): SurfaceLanding | undefined {
    return this.surfaces.highestSurfaceBelow(
      excludedSurfaceId,
      x,
      y,
      radius,
      actorKind,
      belowHeight
    );
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

  hasLineOfSight(
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    surfaceId?: string,
    actorKind: SurfaceActorKind = 'projectile'
  ): boolean {
    const distance = Math.hypot(toX - fromX, toY - fromY);
    const steps = Math.max(1, Math.ceil(distance / 24));
    for (let step = 1; step < steps; step++) {
      const progress = step / steps;
      if (this.isBlockedAt(
        fromX + (toX - fromX) * progress,
        fromY + (toY - fromY) * progress,
        surfaceId,
        actorKind
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

  private legacyProjectionCanOccupy(x: number, y: number, radius: number): boolean {
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

function surfacePhysicsGeometry(
  surface: SurfaceDefinition,
  manifest: SurfaceManifest,
  surfaces: SurfaceMap,
  resolution: number
): PhysicsWorldGeometry {
  let minimumX = Number.POSITIVE_INFINITY;
  let minimumY = Number.POSITIVE_INFINITY;
  let maximumX = Number.NEGATIVE_INFINITY;
  let maximumY = Number.NEGATIVE_INFINITY;
  for (const triangle of surface.triangles) {
    for (const point of [triangle.a, triangle.b, triangle.c]) {
      minimumX = Math.min(minimumX, point.x);
      minimumY = Math.min(minimumY, point.y);
      maximumX = Math.max(maximumX, point.x);
      maximumY = Math.max(maximumY, point.y);
    }
  }
  if (!Number.isFinite(minimumX)) {
    throw new Error(`Physics surface "${surface.id}" contains no triangles.`);
  }
  const originX = Math.floor(minimumX / resolution) * resolution - resolution;
  const originY = Math.floor(minimumY / resolution) * resolution - resolution;
  const width = Math.max(1, Math.ceil((maximumX - originX) / resolution) + 1);
  const height = Math.max(1, Math.ceil((maximumY - originY) / resolution) + 1);
  const collisions = new Array<number>(width * height).fill(1);
  const maximumSurfaceHeight = surface.triangles.reduce((maximum, triangle) => Math.max(
    maximum,
    triangle.a.z,
    triangle.b.z,
    triangle.c.z
  ), Number.NEGATIVE_INFINITY);

  for (let row = 0; row < height; row++) {
    for (let column = 0; column < width; column++) {
      const x = originX + (column + 0.5) * resolution;
      const y = originY + (row + 0.5) * resolution;
      if (surfaces.heightAt(surface.id, x, y) !== undefined) {
        collisions[row * width + column] = 0;
        continue;
      }

      // Missing floor is not itself a wall. GTA2 side-face barriers are meshed
      // separately, so any exposed edge over a lower sheet is a valid drop.
      if (
        surfaces.highestSurfaceBelow(
          surface.id,
          x,
          y,
          0,
          'vehicle',
          maximumSurfaceHeight + 1
        )
      ) {
        collisions[row * width + column] = 0;
      }
    }
  }

  const gatewayRadius = resolution * 1.75;
  for (const transition of manifest.transitions) {
    if (
      transition.fromSurfaceId !== surface.id &&
      transition.toSurfaceId !== surface.id
    ) continue;
    const startColumn = clampInteger(
      Math.floor((Math.min(transition.from.x, transition.to.x) - gatewayRadius - originX) / resolution),
      0,
      width - 1
    );
    const endColumn = clampInteger(
      Math.floor((Math.max(transition.from.x, transition.to.x) + gatewayRadius - originX) / resolution),
      0,
      width - 1
    );
    const startRow = clampInteger(
      Math.floor((Math.min(transition.from.y, transition.to.y) - gatewayRadius - originY) / resolution),
      0,
      height - 1
    );
    const endRow = clampInteger(
      Math.floor((Math.max(transition.from.y, transition.to.y) + gatewayRadius - originY) / resolution),
      0,
      height - 1
    );
    for (let row = startRow; row <= endRow; row++) {
      for (let column = startColumn; column <= endColumn; column++) {
        const x = originX + (column + 0.5) * resolution;
        const y = originY + (row + 0.5) * resolution;
        if (distanceToSegment(x, y, transition.from, transition.to) <= gatewayRadius) {
          collisions[row * width + column] = 0;
        }
      }
    }
  }

  return Object.freeze({
    width,
    height,
    tileWidth: resolution,
    tileHeight: resolution,
    originX,
    originY,
    encloseBorders: false,
    collisions: Object.freeze(collisions),
    barriers: Object.freeze((surface.barriers ?? [])
      .filter((barrier) => !isFallableSurfaceEdge(surface, barrier, surfaces, resolution))
      .map((barrier) => Object.freeze({
        from: barrier.from,
        to: barrier.to,
        thickness: Math.max(3, resolution * 0.125)
      })))
  });
}

function circleOverlapsRect(
  x: number,
  y: number,
  radius: number,
  rect: {minX: number; minY: number; maxX: number; maxY: number}
): boolean {
  const nearestX = Math.max(rect.minX, Math.min(x, rect.maxX));
  const nearestY = Math.max(rect.minY, Math.min(y, rect.maxY));
  return Math.hypot(x - nearestX, y - nearestY) < Math.max(0, radius) || (
    radius <= 0 && x >= rect.minX && x <= rect.maxX && y >= rect.minY && y <= rect.maxY
  );
}

function entranceOutwardVector(
  side: SeamlessInteriorDefinition['entrance']['side']
): {x: number; y: number} {
  if (side === 'north') return {x: 0, y: -1};
  if (side === 'east') return {x: 1, y: 0};
  if (side === 'south') return {x: 0, y: 1};
  return {x: -1, y: 0};
}

function entranceCollisionRect(
  entrance: SeamlessInteriorDefinition['entrance']
): {minX: number; minY: number; maxX: number; maxY: number} {
  const depth = 32;
  const halfWidth = entrance.width / 2;
  const verticalSide = entrance.side === 'east' || entrance.side === 'west';
  return {
    minX: entrance.x - (verticalSide ? depth : halfWidth),
    minY: entrance.y - (verticalSide ? halfWidth : depth),
    maxX: entrance.x + (verticalSide ? depth : halfWidth),
    maxY: entrance.y + (verticalSide ? halfWidth : depth)
  };
}

function isFallableSurfaceEdge(
  surface: SurfaceDefinition,
  barrier: Readonly<{
    from: Readonly<{x: number; y: number}>;
    to: Readonly<{x: number; y: number}>;
  }>,
  surfaces: SurfaceMap,
  resolution: number
): boolean {
  const deltaX = barrier.to.x - barrier.from.x;
  const deltaY = barrier.to.y - barrier.from.y;
  const length = Math.hypot(deltaX, deltaY);
  if (!Number.isFinite(length) || length <= 0) return false;

  const midpointX = (barrier.from.x + barrier.to.x) / 2;
  const midpointY = (barrier.from.y + barrier.to.y) / 2;
  const sampleDistance = Math.max(2, Math.min(resolution * 0.25, length * 0.25));
  const normalX = -deltaY / length;
  const normalY = deltaX / length;
  const samples = [
    {x: midpointX + normalX * sampleDistance, y: midpointY + normalY * sampleDistance},
    {x: midpointX - normalX * sampleDistance, y: midpointY - normalY * sampleDistance}
  ] as const;
  const heights = samples.map((sample) => surfaces.heightAt(surface.id, sample.x, sample.y));
  if (heights[0] === undefined && heights[1] === undefined) return false;

  const edgeProbe = (direction: 1 | -1): Readonly<{
    distance: number;
    hasLowerLanding: boolean;
  }> | undefined => {
    const maximumDistance = resolution * 4.5;
    const step = Math.max(2, resolution * 0.25);
    let referenceHeight = heights[direction === 1 ? 0 : 1] ?? heights.find(
      (height): height is number => height !== undefined
    );
    for (let distance = sampleDistance; distance <= maximumDistance; distance += step) {
      const x = midpointX + normalX * distance * direction;
      const y = midpointY + normalY * distance * direction;
      const currentHeight = surfaces.heightAt(surface.id, x, y);
      if (currentHeight !== undefined) {
        referenceHeight = currentHeight;
        continue;
      }
      return Object.freeze({
        distance,
        hasLowerLanding: Boolean(
        referenceHeight !== undefined &&
        surfaces.highestSurfaceBelow(
          surface.id,
          x,
          y,
          0,
          'vehicle',
          referenceHeight
        )
        )
      });
    }
    return undefined;
  };

  const positiveEdge = edgeProbe(1);
  const negativeEdge = edgeProbe(-1);
  if (heights[0] === undefined || heights[1] === undefined) {
    const outsideEdge = heights[0] === undefined ? positiveEdge : negativeEdge;
    return outsideEdge?.hasLowerLanding ?? false;
  }

  const positiveDrop = positiveEdge?.hasLowerLanding ? positiveEdge.distance : undefined;
  const negativeDrop = negativeEdge?.hasLowerLanding ? negativeEdge.distance : undefined;
  if (positiveDrop === undefined && negativeDrop === undefined) return false;
  if (positiveDrop !== undefined && negativeDrop !== undefined) {
    return Math.abs(positiveDrop - negativeDrop) >= resolution;
  }

  // GTA2 can place a vertical side face one block inward from the actual deck
  // boundary. Only open it when one normal reaches the lower sheet clearly
  // sooner; equal-distance exits indicate an internal divider on a narrow deck.
  const dropDistance = positiveDrop ?? negativeDrop!;
  const oppositeEdge = positiveDrop === undefined ? positiveEdge : negativeEdge;
  return oppositeEdge === undefined || oppositeEdge.distance - dropDistance >= resolution;
}

function distanceToSegment(
  x: number,
  y: number,
  from: Readonly<{x: number; y: number}>,
  to: Readonly<{x: number; y: number}>
): number {
  const deltaX = to.x - from.x;
  const deltaY = to.y - from.y;
  const lengthSquared = deltaX * deltaX + deltaY * deltaY;
  if (lengthSquared === 0) return Math.hypot(x - from.x, y - from.y);
  const progress = Math.max(0, Math.min(1, (
    (x - from.x) * deltaX + (y - from.y) * deltaY
  ) / lengthSquared));
  return Math.hypot(x - (from.x + deltaX * progress), y - (from.y + deltaY * progress));
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, Math.trunc(value)));
}
