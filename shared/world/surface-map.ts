export const SURFACE_MANIFEST_VERSION = 1;

export type SurfaceActorKind = 'player' | 'pedestrian' | 'vehicle' | 'projectile' | 'prop';

import {WORLD_COLLISION_REVISION} from '../simulation/world-collision-revision.ts';

export const STREET_GROUND_SURFACE_ID = 'street-ground';

export interface SurfacePoint {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface SurfaceTriangle {
  readonly a: SurfacePoint;
  readonly b: SurfacePoint;
  readonly c: SurfacePoint;
}

export interface SurfaceBarrier {
  readonly from: Readonly<{x: number; y: number}>;
  readonly to: Readonly<{x: number; y: number}>;
}

export interface SurfaceDefinition {
  readonly id: string;
  readonly spaceId: string;
  readonly actorKinds: readonly SurfaceActorKind[];
  readonly triangles: readonly SurfaceTriangle[];
  readonly barriers?: readonly SurfaceBarrier[];
}

export interface SurfaceTransitionDefinition {
  readonly id: string;
  readonly fromSurfaceId: string;
  readonly toSurfaceId: string;
  readonly from: Readonly<{x: number; y: number}>;
  readonly to: Readonly<{x: number; y: number}>;
  readonly actorKinds: readonly SurfaceActorKind[];
  readonly bidirectional: boolean;
}

export interface SurfaceManifest {
  readonly version: number;
  readonly collisionRevision: number;
  readonly blockSize: number;
  readonly defaultSurfaceId: string;
  readonly surfaces: readonly SurfaceDefinition[];
  readonly transitions: readonly SurfaceTransitionDefinition[];
}

export interface SurfaceCrossing {
  readonly transitionId: string;
  readonly surfaceId: string;
}

export interface SurfaceLanding {
  readonly surfaceId: string;
  readonly height: number;
}

interface SurfaceRuntime {
  readonly definition: SurfaceDefinition;
  readonly buckets: ReadonlyMap<string, readonly SurfaceTriangle[]>;
}

const ACTOR_KINDS: readonly SurfaceActorKind[] = [
  'player', 'pedestrian', 'vehicle', 'projectile', 'prop'
];
const EPSILON = 1e-6;
const FOOTPRINT_DIRECTIONS = Object.freeze([
  [0, 0], [-1, 0], [1, 0], [0, -1], [0, 1],
  [-Math.SQRT1_2, -Math.SQRT1_2], [Math.SQRT1_2, -Math.SQRT1_2],
  [-Math.SQRT1_2, Math.SQRT1_2], [Math.SQRT1_2, Math.SQRT1_2]
] as const);

export class SurfaceMap {
  readonly manifest: SurfaceManifest;
  private readonly surfaces: ReadonlyMap<string, SurfaceRuntime>;
  private readonly surfaceIdsByBucket: ReadonlyMap<string, readonly string[]>;
  private readonly transitions: ReadonlyMap<string, readonly SurfaceTransitionDefinition[]>;
  private readonly transitionBuckets: ReadonlyMap<
    string,
    ReadonlyMap<string, readonly SurfaceTransitionDefinition[]>
  >;

  constructor(input: unknown) {
    this.manifest = validateManifest(input);
    if (this.manifest.collisionRevision !== WORLD_COLLISION_REVISION) {
      throw new Error(
        `Surface manifest collision revision ${this.manifest.collisionRevision} does not match ${WORLD_COLLISION_REVISION}.`
      );
    }
    this.surfaces = new Map(this.manifest.surfaces.map((surface) => [
      surface.id,
      {definition: surface, buckets: indexTriangles(surface.triangles, this.manifest.blockSize)}
    ]));
    const surfaceIdsByBucket = new Map<string, string[]>();
    for (const [surfaceId, surface] of this.surfaces) {
      for (const key of surface.buckets.keys()) {
        const surfaceIds = surfaceIdsByBucket.get(key) ?? [];
        surfaceIds.push(surfaceId);
        surfaceIdsByBucket.set(key, surfaceIds);
      }
    }
    this.surfaceIdsByBucket = new Map([...surfaceIdsByBucket].map(([key, surfaceIds]) => (
      [key, Object.freeze(surfaceIds.sort())]
    )));
    const transitions = new Map<string, SurfaceTransitionDefinition[]>();
    for (const transition of this.manifest.transitions) {
      append(transitions, transition.fromSurfaceId, transition);
      if (transition.bidirectional) append(transitions, transition.toSurfaceId, transition);
    }
    this.transitions = transitions;
    const transitionBuckets = new Map<
      string,
      Map<string, SurfaceTransitionDefinition[]>
    >();
    for (const [surfaceId, surfaceTransitions] of transitions) {
      const buckets = new Map<string, SurfaceTransitionDefinition[]>();
      for (const transition of surfaceTransitions) {
        for (const key of bucketKeysForBounds(
          Math.min(transition.from.x, transition.to.x),
          Math.min(transition.from.y, transition.to.y),
          Math.max(transition.from.x, transition.to.x),
          Math.max(transition.from.y, transition.to.y),
          this.manifest.blockSize
        )) {
          append(buckets, key, transition);
        }
      }
      transitionBuckets.set(surfaceId, buckets);
    }
    this.transitionBuckets = transitionBuckets;
    this.validateTransitions();
  }

  surface(surfaceId: string): SurfaceDefinition | undefined {
    return this.surfaces.get(surfaceId)?.definition;
  }

  surfaceIdsAt(x: number, y: number, actorKind: SurfaceActorKind): readonly string[] {
    if (![x, y].every(Number.isFinite)) return Object.freeze([]);
    return Object.freeze((this.surfaceIdsByBucket.get(
      bucketKey(x, y, this.manifest.blockSize)
    ) ?? [])
      .filter((surfaceId) => (
        this.surface(surfaceId)?.actorKinds.includes(actorKind) &&
        this.heightAt(surfaceId, x, y) !== undefined
      ))
    );
  }

  heightAt(surfaceId: string, x: number, y: number): number | undefined {
    if (![x, y].every(Number.isFinite)) return undefined;
    const surface = this.surfaces.get(surfaceId);
    if (!surface) return undefined;
    const candidates = surface.buckets.get(bucketKey(x, y, this.manifest.blockSize)) ?? [];
    let height: number | undefined;
    for (const triangle of candidates) {
      const sampled = heightOnTriangle(triangle, x, y);
      if (sampled === undefined) continue;
      if (height !== undefined && Math.abs(height - sampled) > EPSILON) return undefined;
      height = sampled;
    }
    return height;
  }

  canOccupy(
    surfaceId: string,
    x: number,
    y: number,
    radius: number,
    actorKind: SurfaceActorKind
  ): boolean {
    const surface = this.surface(surfaceId);
    if (!surface?.actorKinds.includes(actorKind) || !Number.isFinite(radius) || radius < 0) {
      return false;
    }
    for (const [directionX, directionY] of FOOTPRINT_DIRECTIONS) {
      if (this.heightAt(surfaceId, x + directionX * radius, y + directionY * radius) === undefined) {
        return false;
      }
    }
    return true;
  }

  canOccupyConnected(
    surfaceId: string,
    x: number,
    y: number,
    radius: number,
    actorKind: SurfaceActorKind,
    sampleAllowed?: (surfaceId: string, x: number, y: number) => boolean
  ): boolean {
    if (!Number.isFinite(radius) || radius < 0 || !this.surface(surfaceId)) return false;
    for (const [directionX, directionY] of FOOTPRINT_DIRECTIONS) {
      const sampleX = x + directionX * radius;
      const sampleY = y + directionY * radius;
      const sampleSurfaceId = this.transitionFor(
        surfaceId,
        x,
        y,
        sampleX,
        sampleY,
        actorKind
      )?.surfaceId ?? surfaceId;
      if (
        !this.surface(sampleSurfaceId)?.actorKinds.includes(actorKind) ||
        this.heightAt(sampleSurfaceId, sampleX, sampleY) === undefined ||
        (sampleAllowed && !sampleAllowed(sampleSurfaceId, sampleX, sampleY))
      ) return false;
    }
    return true;
  }

  highestSurfaceBelow(
    excludedSurfaceId: string,
    x: number,
    y: number,
    radius: number,
    actorKind: SurfaceActorKind,
    belowHeight: number
  ): SurfaceLanding | undefined {
    if (
      ![x, y, radius, belowHeight].every(Number.isFinite) ||
      radius < 0
    ) return undefined;
    let landing: SurfaceLanding | undefined;
    for (const surfaceId of this.surfaceIdsAt(x, y, actorKind)) {
      if (surfaceId === excludedSurfaceId) continue;
      const height = this.heightAt(surfaceId, x, y);
      if (
        height === undefined ||
        height >= belowHeight - EPSILON ||
        !this.canOccupyConnected(surfaceId, x, y, radius, actorKind)
      ) continue;
      if (!landing || height > landing.height) landing = {surfaceId, height};
    }
    return landing ? Object.freeze(landing) : undefined;
  }

  transitionFor(
    surfaceId: string,
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    actorKind: SurfaceActorKind
  ): SurfaceCrossing | undefined {
    if (![fromX, fromY, toX, toY].every(Number.isFinite)) return undefined;
    const buckets = this.transitionBuckets.get(surfaceId);
    if (!buckets) return undefined;
    const candidates = new Set<SurfaceTransitionDefinition>();
    for (const key of bucketKeysForBounds(
      Math.min(fromX, toX),
      Math.min(fromY, toY),
      Math.max(fromX, toX),
      Math.max(fromY, toY),
      this.manifest.blockSize
    )) {
      for (const transition of buckets.get(key) ?? []) candidates.add(transition);
    }
    for (const transition of candidates) {
      if (!transition.actorKinds.includes(actorKind)) continue;
      if (!segmentsIntersect(fromX, fromY, toX, toY, transition)) continue;
      if (
        pointOnSegment(fromX, fromY, transition) &&
        this.heightAt(surfaceId, toX, toY) !== undefined
      ) continue;
      return Object.freeze({
        transitionId: transition.id,
        surfaceId: transition.fromSurfaceId === surfaceId
          ? transition.toSurfaceId
          : transition.fromSurfaceId
      });
    }
    return undefined;
  }

  neighbors(surfaceId: string, actorKind: SurfaceActorKind): readonly string[] {
    return Object.freeze([...new Set((this.transitions.get(surfaceId) ?? [])
      .filter((transition) => transition.actorKinds.includes(actorKind))
      .map((transition) => transition.fromSurfaceId === surfaceId
        ? transition.toSurfaceId
        : transition.fromSurfaceId))].sort());
  }

  private validateTransitions(): void {
    for (const transition of this.manifest.transitions) {
      const fromSurface = this.surface(transition.fromSurfaceId)!;
      const toSurface = this.surface(transition.toSurfaceId)!;
      if (transition.actorKinds.some((kind) => (
        !fromSurface.actorKinds.includes(kind) || !toSurface.actorKinds.includes(kind)
      ))) {
        throw new Error(`Transition ${transition.id} permits an actor rejected by its surfaces.`);
      }
      for (const progress of [0, 0.5, 1]) {
        const x = transition.from.x + (transition.to.x - transition.from.x) * progress;
        const y = transition.from.y + (transition.to.y - transition.from.y) * progress;
        const fromHeight = this.heightAt(transition.fromSurfaceId, x, y);
        const toHeight = this.heightAt(transition.toSurfaceId, x, y);
        if (
          fromHeight === undefined ||
          toHeight === undefined ||
          Math.abs(fromHeight - toHeight) > EPSILON
        ) {
          throw new Error(`Transition ${transition.id} is not height-continuous.`);
        }
      }
    }
  }
}

function validateManifest(input: unknown): SurfaceManifest {
  const record = object(input, 'Surface manifest');
  const version = positiveInteger(record.version, 'Surface manifest version');
  if (version !== SURFACE_MANIFEST_VERSION) {
    throw new Error(`Unsupported surface manifest version ${version}.`);
  }
  const collisionRevision = positiveInteger(record.collisionRevision, 'Collision revision');
  const blockSize = positiveNumber(record.blockSize, 'Surface block size');
  const defaultSurfaceId = text(record.defaultSurfaceId, 'Default surface ID');
  const rawSurfaces = array(record.surfaces, 'Surfaces');
  if (rawSurfaces.length === 0) throw new Error('Surface manifest must contain a surface.');
  const ids = new Set<string>();
  const surfaces = rawSurfaces.map((rawSurface, index) => {
    const surface = object(rawSurface, `Surface ${index}`);
    const id = text(surface.id, `Surface ${index} ID`);
    if (ids.has(id)) throw new Error(`Duplicate surface ID ${id}.`);
    ids.add(id);
    const triangles = array(surface.triangles, `Surface ${id} triangles`)
      .map((triangle, triangleIndex) => validateTriangle(triangle, id, triangleIndex));
    if (triangles.length === 0) throw new Error(`Surface ${id} must contain a triangle.`);
    const barriers = (surface.barriers === undefined
      ? []
      : array(surface.barriers, `Surface ${id} barriers`)
    ).map((rawBarrier, barrierIndex) => {
      const barrier = object(rawBarrier, `Surface ${id} barrier ${barrierIndex}`);
      const from = point2(barrier.from, `Surface ${id} barrier ${barrierIndex} start`);
      const to = point2(barrier.to, `Surface ${id} barrier ${barrierIndex} end`);
      if (Math.hypot(to.x - from.x, to.y - from.y) <= EPSILON) {
        throw new Error(`Surface ${id} barrier ${barrierIndex} must have length.`);
      }
      return Object.freeze({from, to});
    });
    return Object.freeze({
      id,
      spaceId: text(surface.spaceId, `Surface ${id} space ID`),
      actorKinds: actorKinds(surface.actorKinds, `Surface ${id} actor kinds`),
      triangles: Object.freeze(triangles),
      barriers: Object.freeze(barriers)
    });
  });
  if (!ids.has(defaultSurfaceId)) {
    throw new Error(`Default surface ${defaultSurfaceId} does not exist.`);
  }
  const transitionIds = new Set<string>();
  const transitions = array(record.transitions, 'Surface transitions').map((rawTransition, index) => {
    const transition = object(rawTransition, `Transition ${index}`);
    const id = text(transition.id, `Transition ${index} ID`);
    if (transitionIds.has(id)) throw new Error(`Duplicate transition ID ${id}.`);
    transitionIds.add(id);
    const fromSurfaceId = text(transition.fromSurfaceId, `Transition ${id} source`);
    const toSurfaceId = text(transition.toSurfaceId, `Transition ${id} destination`);
    if (!ids.has(fromSurfaceId) || !ids.has(toSurfaceId) || fromSurfaceId === toSurfaceId) {
      throw new Error(`Transition ${id} must connect two existing distinct surfaces.`);
    }
    const from = point2(transition.from, `Transition ${id} seam start`);
    const to = point2(transition.to, `Transition ${id} seam end`);
    if (Math.hypot(to.x - from.x, to.y - from.y) <= EPSILON) {
      throw new Error(`Transition ${id} seam must have length.`);
    }
    if (typeof transition.bidirectional !== 'boolean') {
      throw new Error(`Transition ${id} bidirectional flag must be boolean.`);
    }
    return Object.freeze({
      id,
      fromSurfaceId,
      toSurfaceId,
      from,
      to,
      actorKinds: actorKinds(transition.actorKinds, `Transition ${id} actor kinds`),
      bidirectional: transition.bidirectional
    });
  });
  return Object.freeze({
    version,
    collisionRevision,
    blockSize,
    defaultSurfaceId,
    surfaces: Object.freeze(surfaces),
    transitions: Object.freeze(transitions)
  });
}

function validateTriangle(input: unknown, surfaceId: string, index: number): SurfaceTriangle {
  const triangle = object(input, `Surface ${surfaceId} triangle ${index}`);
  const a = point3(triangle.a, `Surface ${surfaceId} triangle ${index} point A`);
  const b = point3(triangle.b, `Surface ${surfaceId} triangle ${index} point B`);
  const c = point3(triangle.c, `Surface ${surfaceId} triangle ${index} point C`);
  if (Math.abs(cross(a.x, a.y, b.x, b.y, c.x, c.y)) <= EPSILON) {
    throw new Error(`Surface ${surfaceId} triangle ${index} has no XY area.`);
  }
  return Object.freeze({a, b, c});
}

function indexTriangles(
  triangles: readonly SurfaceTriangle[],
  blockSize: number
): ReadonlyMap<string, readonly SurfaceTriangle[]> {
  const buckets = new Map<string, SurfaceTriangle[]>();
  for (const triangle of triangles) {
    const minColumn = Math.floor(Math.min(triangle.a.x, triangle.b.x, triangle.c.x) / blockSize);
    const maxColumn = Math.floor(Math.max(triangle.a.x, triangle.b.x, triangle.c.x) / blockSize);
    const minRow = Math.floor(Math.min(triangle.a.y, triangle.b.y, triangle.c.y) / blockSize);
    const maxRow = Math.floor(Math.max(triangle.a.y, triangle.b.y, triangle.c.y) / blockSize);
    for (let row = minRow; row <= maxRow; row++) {
      for (let column = minColumn; column <= maxColumn; column++) {
        const key = `${column}:${row}`;
        const entries = buckets.get(key) ?? [];
        entries.push(triangle);
        buckets.set(key, entries);
      }
    }
  }
  return new Map([...buckets].map(([key, entries]) => [key, Object.freeze(entries)]));
}

function heightOnTriangle(triangle: SurfaceTriangle, x: number, y: number): number | undefined {
  const denominator = cross(
    triangle.a.x, triangle.a.y,
    triangle.b.x, triangle.b.y,
    triangle.c.x, triangle.c.y
  );
  const weightA = cross(x, y, triangle.b.x, triangle.b.y, triangle.c.x, triangle.c.y) / denominator;
  const weightB = cross(triangle.a.x, triangle.a.y, x, y, triangle.c.x, triangle.c.y) / denominator;
  const weightC = 1 - weightA - weightB;
  if (weightA < -EPSILON || weightB < -EPSILON || weightC < -EPSILON) return undefined;
  return weightA * triangle.a.z + weightB * triangle.b.z + weightC * triangle.c.z;
}

function pointOnSegment(
  x: number,
  y: number,
  segment: Pick<SurfaceTransitionDefinition, 'from' | 'to'>
): boolean {
  return Math.abs(cross(segment.from.x, segment.from.y, segment.to.x, segment.to.y, x, y)) <= EPSILON &&
    x + EPSILON >= Math.min(segment.from.x, segment.to.x) &&
    x - EPSILON <= Math.max(segment.from.x, segment.to.x) &&
    y + EPSILON >= Math.min(segment.from.y, segment.to.y) &&
    y - EPSILON <= Math.max(segment.from.y, segment.to.y);
}

function segmentsIntersect(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  seam: Pick<SurfaceTransitionDefinition, 'from' | 'to'>
): boolean {
  if (Math.hypot(toX - fromX, toY - fromY) <= EPSILON) return false;
  if (
    Math.max(fromX, toX) + EPSILON < Math.min(seam.from.x, seam.to.x) ||
    Math.max(seam.from.x, seam.to.x) + EPSILON < Math.min(fromX, toX) ||
    Math.max(fromY, toY) + EPSILON < Math.min(seam.from.y, seam.to.y) ||
    Math.max(seam.from.y, seam.to.y) + EPSILON < Math.min(fromY, toY)
  ) return false;
  const first = cross(fromX, fromY, toX, toY, seam.from.x, seam.from.y);
  const second = cross(fromX, fromY, toX, toY, seam.to.x, seam.to.y);
  const third = cross(seam.from.x, seam.from.y, seam.to.x, seam.to.y, fromX, fromY);
  const fourth = cross(seam.from.x, seam.from.y, seam.to.x, seam.to.y, toX, toY);
  return first * second <= EPSILON && third * fourth <= EPSILON;
}

function cross(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

function append(
  map: Map<string, SurfaceTransitionDefinition[]>,
  surfaceId: string,
  transition: SurfaceTransitionDefinition
): void {
  const entries = map.get(surfaceId) ?? [];
  entries.push(transition);
  map.set(surfaceId, entries);
}

function bucketKey(x: number, y: number, blockSize: number): string {
  return `${Math.floor(x / blockSize)}:${Math.floor(y / blockSize)}`;
}

function bucketKeysForBounds(
  minimumX: number,
  minimumY: number,
  maximumX: number,
  maximumY: number,
  blockSize: number
): readonly string[] {
  const keys: string[] = [];
  const minimumColumn = Math.floor(minimumX / blockSize);
  const maximumColumn = Math.floor(maximumX / blockSize);
  const minimumRow = Math.floor(minimumY / blockSize);
  const maximumRow = Math.floor(maximumY / blockSize);
  for (let row = minimumRow; row <= maximumRow; row++) {
    for (let column = minimumColumn; column <= maximumColumn; column++) {
      keys.push(`${column}:${row}`);
    }
  }
  return keys;
}

function actorKinds(input: unknown, label: string): readonly SurfaceActorKind[] {
  const values = array(input, label).map((value) => text(value, label));
  if (values.length === 0 || values.some((value) => !ACTOR_KINDS.includes(value as SurfaceActorKind))) {
    throw new Error(`${label} must contain supported actor kinds.`);
  }
  return Object.freeze([...new Set(values)] as SurfaceActorKind[]);
}

function point2(input: unknown, label: string): Readonly<{x: number; y: number}> {
  const point = object(input, label);
  return Object.freeze({x: finite(point.x, `${label} X`), y: finite(point.y, `${label} Y`)});
}

function point3(input: unknown, label: string): SurfacePoint {
  const point = object(input, label);
  return Object.freeze({
    x: finite(point.x, `${label} X`),
    y: finite(point.y, `${label} Y`),
    z: finite(point.z, `${label} Z`)
  });
}

function object(input: unknown, label: string): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error(`${label} must be an object.`);
  }
  return input as Record<string, unknown>;
}

function array(input: unknown, label: string): unknown[] {
  if (!Array.isArray(input)) throw new Error(`${label} must be an array.`);
  return input;
}

function text(input: unknown, label: string): string {
  if (typeof input !== 'string' || !input.trim()) throw new Error(`${label} must be a string.`);
  return input;
}

function finite(input: unknown, label: string): number {
  if (typeof input !== 'number' || !Number.isFinite(input)) throw new Error(`${label} must be finite.`);
  return input;
}

function positiveNumber(input: unknown, label: string): number {
  const value = finite(input, label);
  if (value <= 0) throw new Error(`${label} must be positive.`);
  return value;
}

function positiveInteger(input: unknown, label: string): number {
  const value = finite(input, label);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} must be a positive integer.`);
  return value;
}
