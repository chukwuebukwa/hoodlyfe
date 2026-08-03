import rawManifest from './buildings/buildings.json';

export type BuildingMode = 'isolated' | 'seamless-cutaway';
export type BuildingKind =
  | 'store'
  | 'apartment'
  | 'warehouse'
  | 'garage'
  | 'office'
  | 'civic'
  | 'safehouse';
export type BuildingCutawayMode = 'lid-only' | 'complete-above-floor';
export type BuildingEntranceSide = 'north' | 'east' | 'south' | 'west';
export type BuildingObstacleKind = 'wall' | 'counter' | 'shelf' | 'cooler';
export type BuildingServiceType = 'ammunition' | 'clothing' | 'medical' | 'repair' | 'job' | 'shop';

export interface SourceRect {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

export interface SourceBounds3D extends SourceRect {
  readonly minZ: number;
  readonly maxZ: number;
}

export interface BuildingShellDefinition {
  readonly cutawayMode: BuildingCutawayMode;
  readonly bounds: SourceBounds3D;
  readonly expectedTriangleCount: number;
}

export interface BuildingEntranceDefinition {
  readonly side: BuildingEntranceSide;
  readonly x: number;
  readonly y: number;
  readonly width: number;
}

export interface BuildingGarageDoorDefinition {
  readonly height: number;
  readonly thickness: number;
  readonly openRadius: number;
  readonly animationMs: number;
  readonly holdOpenMs: number;
}

export interface BuildingObstacleDefinition {
  readonly id: string;
  readonly kind: BuildingObstacleKind;
  readonly bounds: SourceRect;
  readonly height: number;
  readonly color: string;
}

export interface BuildingSignageDefinition {
  readonly exterior: string;
  readonly service?: string;
}

export interface BuildingServiceBinding {
  readonly id: string;
  readonly type: BuildingServiceType;
  readonly label: string;
  readonly x: number;
  readonly y: number;
}

export interface BuildingDefinition {
  readonly id: string;
  readonly label: string;
  readonly mode: BuildingMode;
  readonly kind: BuildingKind;
  readonly floorZ: number;
  readonly roofHeight: number;
  readonly shell: BuildingShellDefinition;
  readonly entrance: BuildingEntranceDefinition;
  readonly garageDoor?: BuildingGarageDoorDefinition;
  readonly signage?: BuildingSignageDefinition;
  readonly serviceBindings: readonly BuildingServiceBinding[];
  readonly bounds?: SourceRect;
  readonly footprints: readonly SourceRect[];
  readonly floorConnectors: readonly SourceRect[];
  readonly revealAreas: readonly SourceRect[];
  readonly obstacles: readonly BuildingObstacleDefinition[];
}

export interface BuildingManifest {
  readonly version: 1;
  readonly sourceLevel: string;
  readonly blockSize: number;
  readonly buildings: readonly BuildingDefinition[];
}

const ID_PATTERN = /^[a-z][a-z0-9-]*$/;
const COLOR_PATTERN = /^#[0-9a-f]{6}$/i;
const BUILDING_KINDS = new Set<BuildingKind>([
  'store',
  'apartment',
  'warehouse',
  'garage',
  'office',
  'civic',
  'safehouse'
]);

export const BUILDING_MANIFEST = parseBuildingManifest(rawManifest);

export function parseBuildingManifest(raw: unknown, source = 'buildings.json'): BuildingManifest {
  const root = record(raw, source);
  if (root.version !== 1) throw new Error(`${source}: version must be 1.`);
  const sourceLevel = string(root.sourceLevel, `${source}.sourceLevel`);
  const blockSize = positiveNumber(root.blockSize, `${source}.blockSize`);
  const values = array(root.buildings, `${source}.buildings`);
  const ids = new Set<string>();
  const serviceIds = new Set<string>();
  const buildings = values.map((value, index) => {
    const path = `${source}.buildings[${index}]`;
    const building = parseBuilding(value, path);
    if (ids.has(building.id)) throw new Error(`${path}: duplicate building id "${building.id}".`);
    ids.add(building.id);
    for (const service of building.serviceBindings) {
      if (serviceIds.has(service.id)) {
        throw new Error(`${path}: duplicate service id "${service.id}".`);
      }
      serviceIds.add(service.id);
    }
    return building;
  });
  if (buildings.length === 0) throw new Error(`${source}: at least one building is required.`);
  return Object.freeze({version: 1, sourceLevel, blockSize, buildings: Object.freeze(buildings)});
}

function parseBuilding(raw: unknown, path: string): BuildingDefinition {
  const value = record(raw, path);
  const id = string(value.id, `${path}.id`);
  if (!ID_PATTERN.test(id)) throw new Error(`${path}.id must be kebab-case.`);
  const mode = value.mode;
  if (mode !== 'isolated' && mode !== 'seamless-cutaway') {
    throw new Error(`${path}.mode is invalid.`);
  }
  const kind = value.kind;
  if (typeof kind !== 'string' || !BUILDING_KINDS.has(kind as BuildingKind)) {
    throw new Error(`${path}.kind is invalid.`);
  }
  const shellValue = record(value.shell, `${path}.shell`);
  const cutawayMode = shellValue.cutawayMode;
  if (cutawayMode !== 'lid-only' && cutawayMode !== 'complete-above-floor') {
    throw new Error(`${path}.shell.cutawayMode is invalid.`);
  }
  const obstacleIds = new Set<string>();
  const obstacles = optionalArray(value.obstacles, `${path}.obstacles`).map((entry, index) => {
    const obstaclePath = `${path}.obstacles[${index}]`;
    const obstacle = parseObstacle(entry, obstaclePath);
    if (obstacleIds.has(obstacle.id)) {
      throw new Error(`${obstaclePath}: duplicate obstacle id "${obstacle.id}".`);
    }
    obstacleIds.add(obstacle.id);
    return obstacle;
  });
  const footprints = optionalRects(value.footprints, `${path}.footprints`);
  const floorConnectors = optionalRects(value.floorConnectors, `${path}.floorConnectors`);
  const revealAreas = optionalRects(value.revealAreas, `${path}.revealAreas`);
  const bounds = value.bounds === undefined ? undefined : rect(value.bounds, `${path}.bounds`);
  const garageDoor = value.garageDoor === undefined
    ? undefined
    : parseGarageDoor(value.garageDoor, `${path}.garageDoor`);
  const serviceIds = new Set<string>();
  const serviceBindings = optionalArray(value.serviceBindings, `${path}.serviceBindings`)
    .map((entry, index) => {
      const servicePath = `${path}.serviceBindings[${index}]`;
      const service = serviceBinding(entry, servicePath);
      if (serviceIds.has(service.id)) {
        throw new Error(`${servicePath}: duplicate service id "${service.id}".`);
      }
      serviceIds.add(service.id);
      return service;
    });
  if (mode === 'seamless-cutaway') {
    if (!bounds || footprints.length === 0 || revealAreas.length === 0) {
      throw new Error(`${path}: seamless buildings require bounds, footprints, and revealAreas.`);
    }
    if (cutawayMode !== 'complete-above-floor') {
      throw new Error(`${path}: seamless buildings require complete-above-floor cutaway.`);
    }
    for (const [index, area] of revealAreas.entries()) {
      if (!rectContainedByAny(area, [...footprints, ...floorConnectors])) {
        throw new Error(`${path}.revealAreas[${index}] is outside the playable footprint.`);
      }
    }
  }
  if (garageDoor && kind !== 'garage') {
    throw new Error(`${path}.garageDoor is only valid for garage buildings.`);
  }
  return Object.freeze({
    id,
    label: string(value.label, `${path}.label`),
    mode,
    kind: kind as BuildingKind,
    floorZ: finiteNumber(value.floorZ, `${path}.floorZ`),
    roofHeight: positiveNumber(value.roofHeight, `${path}.roofHeight`),
    shell: Object.freeze({
      cutawayMode,
      bounds: bounds3d(shellValue.bounds, `${path}.shell.bounds`),
      expectedTriangleCount: positiveInteger(
        shellValue.expectedTriangleCount,
        `${path}.shell.expectedTriangleCount`
      )
    }),
    entrance: entrance(value.entrance, `${path}.entrance`),
    garageDoor,
    signage: value.signage === undefined ? undefined : signage(value.signage, `${path}.signage`),
    serviceBindings: Object.freeze(serviceBindings),
    bounds,
    footprints: Object.freeze(footprints),
    floorConnectors: Object.freeze(floorConnectors),
    revealAreas: Object.freeze(revealAreas),
    obstacles: Object.freeze(obstacles)
  });
}

function parseGarageDoor(raw: unknown, path: string): BuildingGarageDoorDefinition {
  const value = record(raw, path);
  return Object.freeze({
    height: positiveNumber(value.height, `${path}.height`),
    thickness: positiveNumber(value.thickness, `${path}.thickness`),
    openRadius: positiveNumber(value.openRadius, `${path}.openRadius`),
    animationMs: positiveNumber(value.animationMs, `${path}.animationMs`),
    holdOpenMs: positiveNumber(value.holdOpenMs, `${path}.holdOpenMs`)
  });
}

function serviceBinding(raw: unknown, path: string): BuildingServiceBinding {
  const value = record(raw, path);
  const id = string(value.id, `${path}.id`);
  if (!ID_PATTERN.test(id)) throw new Error(`${path}.id must be kebab-case.`);
  const type = value.type;
  if (
    type !== 'ammunition' && type !== 'clothing' && type !== 'medical' &&
    type !== 'repair' && type !== 'job' && type !== 'shop'
  ) {
    throw new Error(`${path}.type is invalid.`);
  }
  return Object.freeze({
    id,
    type,
    label: string(value.label, `${path}.label`),
    x: finiteNumber(value.x, `${path}.x`),
    y: finiteNumber(value.y, `${path}.y`)
  });
}

function signage(raw: unknown, path: string): BuildingSignageDefinition {
  const value = record(raw, path);
  return Object.freeze({
    exterior: string(value.exterior, `${path}.exterior`),
    service: value.service === undefined ? undefined : string(value.service, `${path}.service`)
  });
}

function parseObstacle(raw: unknown, path: string): BuildingObstacleDefinition {
  const value = record(raw, path);
  const id = string(value.id, `${path}.id`);
  if (!ID_PATTERN.test(id)) throw new Error(`${path}.id must be kebab-case.`);
  const kind = value.kind;
  if (kind !== 'wall' && kind !== 'counter' && kind !== 'shelf' && kind !== 'cooler') {
    throw new Error(`${path}.kind is invalid.`);
  }
  const color = string(value.color, `${path}.color`);
  if (!COLOR_PATTERN.test(color)) throw new Error(`${path}.color must be a six-digit hex color.`);
  return Object.freeze({
    id,
    kind,
    bounds: rect(value.bounds, `${path}.bounds`),
    height: positiveNumber(value.height, `${path}.height`),
    color
  });
}

function entrance(raw: unknown, path: string): BuildingEntranceDefinition {
  const value = record(raw, path);
  const side = value.side;
  if (side !== 'north' && side !== 'east' && side !== 'south' && side !== 'west') {
    throw new Error(`${path}.side is invalid.`);
  }
  return Object.freeze({
    side,
    x: finiteNumber(value.x, `${path}.x`),
    y: finiteNumber(value.y, `${path}.y`),
    width: positiveNumber(value.width, `${path}.width`)
  });
}

function optionalRects(raw: unknown, path: string): SourceRect[] {
  return optionalArray(raw, path).map((value, index) => rect(value, `${path}[${index}]`));
}

function rect(raw: unknown, path: string): SourceRect {
  const value = record(raw, path);
  const result = Object.freeze({
    minX: finiteNumber(value.minX, `${path}.minX`),
    minY: finiteNumber(value.minY, `${path}.minY`),
    maxX: finiteNumber(value.maxX, `${path}.maxX`),
    maxY: finiteNumber(value.maxY, `${path}.maxY`)
  });
  if (result.minX >= result.maxX || result.minY >= result.maxY) {
    throw new Error(`${path} must have positive dimensions.`);
  }
  return result;
}

function bounds3d(raw: unknown, path: string): SourceBounds3D {
  const value = record(raw, path);
  const base = rect(value, path);
  const result = Object.freeze({
    ...base,
    minZ: finiteNumber(value.minZ, `${path}.minZ`),
    maxZ: finiteNumber(value.maxZ, `${path}.maxZ`)
  });
  if (result.minZ >= result.maxZ) throw new Error(`${path} must have positive Z dimensions.`);
  return result;
}

function rectContainedByAny(inner: SourceRect, containers: readonly SourceRect[]): boolean {
  return containers.some((outer) => (
    inner.minX >= outer.minX && inner.minY >= outer.minY &&
    inner.maxX <= outer.maxX && inner.maxY <= outer.maxY
  ));
}

function record(raw: unknown, path: string): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`${path}: expected an object.`);
  }
  return raw as Record<string, unknown>;
}

function array(raw: unknown, path: string): unknown[] {
  if (!Array.isArray(raw)) throw new Error(`${path}: expected an array.`);
  return raw;
}

function optionalArray(raw: unknown, path: string): unknown[] {
  return raw === undefined ? [] : array(raw, path);
}

function string(raw: unknown, path: string): string {
  if (typeof raw !== 'string' || raw.length === 0) throw new Error(`${path}: expected text.`);
  return raw;
}

function finiteNumber(raw: unknown, path: string): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    throw new Error(`${path}: expected a finite number.`);
  }
  return raw;
}

function positiveNumber(raw: unknown, path: string): number {
  const value = finiteNumber(raw, path);
  if (value <= 0) throw new Error(`${path}: expected a positive number.`);
  return value;
}

function positiveInteger(raw: unknown, path: string): number {
  const value = positiveNumber(raw, path);
  if (!Number.isInteger(value)) throw new Error(`${path}: expected an integer.`);
  return value;
}
