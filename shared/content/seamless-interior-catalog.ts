import type {SurfaceActorKind} from '../world/surface-map.ts';
import {
  BUILDING_MANIFEST,
  type BuildingDefinition,
  type BuildingKind,
  type BuildingServiceType,
  type SourceRect
} from './building-manifest.ts';

export interface WorldRect {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

export interface SeamlessInteriorObstacle extends WorldRect {
  readonly id: string;
  readonly kind: 'wall' | 'counter' | 'shelf' | 'cooler';
  readonly height: number;
  readonly color: number;
}

export interface SeamlessGarageDoorDefinition extends WorldRect {
  readonly id: string;
  readonly side: SeamlessInteriorDefinition['entrance']['side'];
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly thickness: number;
  readonly openRadius: number;
  readonly animationMs: number;
  readonly holdOpenMs: number;
}

export interface SeamlessInteriorDefinition {
  readonly id: string;
  readonly label: string;
  readonly kind: BuildingKind;
  readonly bounds: WorldRect;
  readonly footprints: readonly WorldRect[];
  readonly floorConnectors: readonly WorldRect[];
  readonly revealAreas: readonly WorldRect[];
  readonly floorZ: number;
  readonly roofHeight: number;
  readonly roofTriangleCount: number;
  readonly entrance: Readonly<{
    side: 'north' | 'east' | 'south' | 'west';
    x: number;
    y: number;
    width: number;
  }>;
  readonly garageDoor?: SeamlessGarageDoorDefinition;
  readonly signage: Readonly<{
    exterior: string;
    service?: string;
  }>;
  readonly serviceBindings: readonly Readonly<{
    id: string;
    type: BuildingServiceType;
    label: string;
    x: number;
    y: number;
  }>[];
  readonly obstacles: readonly SeamlessInteriorObstacle[];
}

export const SEAMLESS_INTERIORS: readonly SeamlessInteriorDefinition[] = Object.freeze(
  BUILDING_MANIFEST.buildings
    .filter((building) => building.mode === 'seamless-cutaway')
    .map((building) => compileSeamlessInterior(building, BUILDING_MANIFEST.blockSize))
);

export const SEAMLESS_COLLISION_REPLACEMENT_RECTS: readonly WorldRect[] = Object.freeze(
  SEAMLESS_INTERIORS.flatMap(({footprints, floorConnectors, entrance}) => [
    ...footprints,
    ...floorConnectors,
    entranceCollisionRect(entrance)
  ])
);

export const SEAMLESS_STATIC_RECTS: readonly WorldRect[] = Object.freeze(
  SEAMLESS_INTERIORS.flatMap(({obstacles}) => obstacles.map(({minX, minY, maxX, maxY}) => (
    Object.freeze({minX, minY, maxX, maxY})
  )))
);

export const SEAMLESS_GARAGE_DOORS: readonly SeamlessGarageDoorDefinition[] = Object.freeze(
  SEAMLESS_INTERIORS.flatMap(({garageDoor}) => garageDoor ? [garageDoor] : [])
);

export const SEAMLESS_ROOF_EXIT_MARGIN = 24;

export function seamlessInteriorDefinition(id: string): SeamlessInteriorDefinition | undefined {
  return SEAMLESS_INTERIORS.find((definition) => definition.id === id);
}

export function seamlessServiceAnchor(id: string):
  SeamlessInteriorDefinition['serviceBindings'][number] | undefined {
  for (const interior of SEAMLESS_INTERIORS) {
    const service = interior.serviceBindings.find((candidate) => candidate.id === id);
    if (service) return service;
  }
  return undefined;
}

export function seamlessGarageDoor(id: string): SeamlessGarageDoorDefinition | undefined {
  return SEAMLESS_GARAGE_DOORS.find((door) => door.id === id);
}

export function seamlessServiceAnchors(
  type?: BuildingServiceType
): readonly SeamlessInteriorDefinition['serviceBindings'][number][] {
  return Object.freeze(SEAMLESS_INTERIORS.flatMap(({serviceBindings}) => (
    type ? serviceBindings.filter((service) => service.type === type) : serviceBindings
  )));
}

export function seamlessInteriorAt(
  x: number,
  y: number,
  currentId?: string
): SeamlessInteriorDefinition | undefined {
  const current = currentId ? seamlessInteriorDefinition(currentId) : undefined;
  if (current && current.revealAreas.some((area) => (
    containsPoint(expandRect(area, SEAMLESS_ROOF_EXIT_MARGIN), x, y)
  ))) {
    return current;
  }
  return SEAMLESS_INTERIORS.find(({revealAreas}) => (
    revealAreas.some((area) => containsPoint(area, x, y))
  ));
}

export function blocksSeamlessInterior(
  x: number,
  y: number,
  radius: number,
  _actorKind: SurfaceActorKind = 'player'
): boolean {
  return SEAMLESS_STATIC_RECTS.some((rect) => circleOverlapsRect(x, y, radius, rect));
}

export function replacesSeamlessWorldCollision(x: number, y: number): boolean {
  return SEAMLESS_COLLISION_REPLACEMENT_RECTS.some((rect) => containsPoint(rect, x, y));
}

export function containsPoint(rect: WorldRect, x: number, y: number): boolean {
  return x >= rect.minX && x <= rect.maxX && y >= rect.minY && y <= rect.maxY;
}

function entranceCollisionRect(
  entrance: SeamlessInteriorDefinition['entrance']
): WorldRect {
  const depth = 32;
  const halfWidth = entrance.width / 2;
  const verticalSide = entrance.side === 'east' || entrance.side === 'west';
  return Object.freeze({
    minX: entrance.x - (verticalSide ? depth : halfWidth),
    minY: entrance.y - (verticalSide ? halfWidth : depth),
    maxX: entrance.x + (verticalSide ? depth : halfWidth),
    maxY: entrance.y + (verticalSide ? halfWidth : depth)
  });
}

function circleOverlapsRect(x: number, y: number, radius: number, rect: WorldRect): boolean {
  if (radius <= 0) return containsPoint(rect, x, y);
  const nearestX = Math.max(rect.minX, Math.min(x, rect.maxX));
  const nearestY = Math.max(rect.minY, Math.min(y, rect.maxY));
  return Math.hypot(x - nearestX, y - nearestY) < radius;
}

function expandRect(rect: WorldRect, amount: number): WorldRect {
  return {
    minX: rect.minX - amount,
    minY: rect.minY - amount,
    maxX: rect.maxX + amount,
    maxY: rect.maxY + amount
  };
}

function compileSeamlessInterior(
  building: BuildingDefinition,
  blockSize: number
): SeamlessInteriorDefinition {
  if (building.mode !== 'seamless-cutaway' || !building.bounds) {
    throw new Error(`Building "${building.id}" is not a seamless interior.`);
  }
  const entrance = Object.freeze({
    side: building.entrance.side,
    x: building.entrance.x * blockSize,
    y: building.entrance.y * blockSize,
    width: building.entrance.width * blockSize
  });
  return Object.freeze({
    id: building.id,
    label: building.label,
    kind: building.kind,
    bounds: scaleRect(building.bounds, blockSize),
    footprints: scaleRects(building.footprints, blockSize),
    floorConnectors: scaleRects(building.floorConnectors, blockSize),
    revealAreas: scaleRects(building.revealAreas, blockSize),
    floorZ: building.floorZ * blockSize,
    roofHeight: building.roofHeight * blockSize,
    roofTriangleCount: building.shell.expectedTriangleCount,
    entrance,
    garageDoor: building.garageDoor
      ? compileGarageDoor(building.id, entrance, building.garageDoor, blockSize)
      : undefined,
    signage: Object.freeze({
      exterior: building.signage?.exterior ?? building.label,
      service: building.signage?.service
    }),
    serviceBindings: Object.freeze(building.serviceBindings.map((service) => Object.freeze({
      id: service.id,
      type: service.type,
      label: service.label,
      x: service.x * blockSize,
      y: service.y * blockSize
    }))),
    obstacles: Object.freeze(building.obstacles.map((entry) => Object.freeze({
      id: entry.id,
      kind: entry.kind,
      ...scaleRect(entry.bounds, blockSize),
      height: entry.height * blockSize,
      color: Number.parseInt(entry.color.slice(1), 16)
    })))
  });
}

function compileGarageDoor(
  id: string,
  entrance: SeamlessInteriorDefinition['entrance'],
  source: NonNullable<BuildingDefinition['garageDoor']>,
  blockSize: number
): SeamlessGarageDoorDefinition {
  const thickness = source.thickness * blockSize;
  const verticalSide = entrance.side === 'east' || entrance.side === 'west';
  return Object.freeze({
    id,
    side: entrance.side,
    x: entrance.x,
    y: entrance.y,
    width: entrance.width,
    height: source.height * blockSize,
    thickness,
    openRadius: source.openRadius * blockSize,
    animationMs: source.animationMs,
    holdOpenMs: source.holdOpenMs,
    minX: entrance.x - (verticalSide ? thickness : entrance.width) / 2,
    minY: entrance.y - (verticalSide ? entrance.width : thickness) / 2,
    maxX: entrance.x + (verticalSide ? thickness : entrance.width) / 2,
    maxY: entrance.y + (verticalSide ? entrance.width : thickness) / 2
  });
}

function scaleRects(rects: readonly SourceRect[], blockSize: number): readonly WorldRect[] {
  return Object.freeze(rects.map((value) => scaleRect(value, blockSize)));
}

function scaleRect(rect: SourceRect, blockSize: number): WorldRect {
  return Object.freeze({
    minX: rect.minX * blockSize,
    minY: rect.minY * blockSize,
    maxX: rect.maxX * blockSize,
    maxY: rect.maxY * blockSize
  });
}
