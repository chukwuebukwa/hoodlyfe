import {
  STREET_PROP_PROTOTYPE_IDS,
  streetPropDamageStage,
  streetPropDefinition,
  type StreetPropDefinitionId
} from '../../../shared/content/street-props.ts';
import {StreetPropState, type DistrictState} from '../../state.ts';
import type {CollisionMap} from '../../world-map.ts';
import {STREET_GROUND_SURFACE_ID} from '../../../shared/world/surface-map.ts';
import {VEHICLE_RADIUS} from '../vehicles/vehicle-config.ts';

const RESET_DELAY_MS = 8_000;
export const VEHICLE_PROP_BREAK_SPEED = 95;
const PROP_SPATIAL_CELL_SIZE = 256;
const MAX_PROP_HIT_RADIUS = 24;
const PROP_SPACING = Object.freeze({
  dumpster: 176,
  hydrant: 128,
  'trash-can': 88
});

interface StreetPropControllerOptions {
  state: DistrictState;
  world: CollisionMap;
}

function circleHitProgress(
  pointX: number,
  pointY: number,
  radius: number,
  startX: number,
  startY: number,
  endX: number,
  endY: number
): number | undefined {
  const segmentX = endX - startX;
  const segmentY = endY - startY;
  const lengthSquared = segmentX * segmentX + segmentY * segmentY;
  if (lengthSquared === 0) {
    return Math.hypot(pointX - startX, pointY - startY) <= radius ? 0 : undefined;
  }
  const progress = ((pointX - startX) * segmentX + (pointY - startY) * segmentY) /
    lengthSquared;
  const distance = Math.hypot(
    pointX - (startX + segmentX * progress),
    pointY - (startY + segmentY * progress)
  );
  if (distance > radius) return undefined;
  const normalizedOffset = Math.sqrt(Math.max(0, radius * radius - distance * distance)) /
    Math.sqrt(lengthSquared);
  const entry = progress - normalizedOffset;
  const exit = progress + normalizedOffset;
  return entry <= 1 && exit >= 0 ? Math.max(0, Math.min(1, entry)) : undefined;
}

export interface StreetPropSegmentHit {
  prop: StreetPropState;
  progress: number;
}

export class StreetPropController {
  private readonly propSpatial = new Map<string, StreetPropState[]>();
  private readonly previousVehiclePositions = new Map<
    string,
    {x: number; y: number; surfaceId: string}
  >();

  constructor(private readonly options: StreetPropControllerOptions) {}

  initialize(): void {
    if (this.options.state.streetProps.size > 0) {
      for (const prop of this.options.state.streetProps.values()) this.indexProp(prop);
      return;
    }
    if (typeof this.options.world.physicsGeometry !== 'function') return;
    this.initializeDistrictProps();
  }

  private initializeDistrictProps(): void {
    const geometry = this.options.world.physicsGeometry();
    const cellCount = geometry.width * geometry.height;
    const quotas = new Map<string, number>([
      ['hydrant', clamp(Math.round(cellCount / 500), 24, 180)],
      ['trash-can', clamp(Math.round(cellCount / 350), 36, 260)],
      ['dumpster', clamp(Math.round(cellCount / 900), 18, 120)]
    ]);
    const candidates: PropPlacementCandidate[] = [];
    for (let row = 2; row < geometry.height - 2; row++) {
      for (let column = 2; column < geometry.width - 2; column++) {
        if (geometry.collisions[row * geometry.width + column] !== 0) continue;
        const x = (column + 0.5) * geometry.tileWidth;
        const y = (row + 0.5) * geometry.tileHeight;
        if (this.options.world.isRoadAt(x, y)) continue;
        const road = nearestRoadCell(
          this.options.world,
          column,
          row,
          geometry.tileWidth,
          geometry.tileHeight,
          4
        );
        if (!road) continue;
        const blockedNeighbors = adjacentBlockedCount(
          geometry.collisions,
          geometry.width,
          geometry.height,
          column,
          row
        );
        const seed = placementHash(column, row, geometry.width, geometry.height);
        const family = selectPropFamily(road.distance, blockedNeighbors, seed);
        if (!family) continue;
        const definitionId = STREET_PROP_PROTOTYPE_IDS.find((id) => (
          streetPropDefinition(id)?.family === family
        ));
        if (!definitionId) continue;
        const definition = streetPropDefinition(definitionId);
        if (!definition) continue;
        const surfacesAtCandidate = this.options.world.surfaces.surfaceIdsAt(x, y, 'prop');
        if (surfacesAtCandidate.some((surface) => surface !== STREET_GROUND_SURFACE_ID)) continue;
        if (!this.options.world.canOccupy(
          x,
          y,
          definition.hitRadius,
          STREET_GROUND_SURFACE_ID,
          'prop'
        )) continue;
        const roadAngle = Math.atan2(road.row - row, road.column - column);
        candidates.push({
          column,
          row,
          x,
          y,
          surfaceId: STREET_GROUND_SURFACE_ID,
          definitionId,
          family,
          angle: family === 'dumpster' ? roadAngle + Math.PI / 2 : roadAngle,
          score: seed
        });
      }
    }

    candidates.sort((left, right) => left.score - right.score);
    const placed = [...this.options.state.streetProps.values()].map((prop) => ({
      x: prop.x,
      y: prop.y,
      family: streetPropDefinition(prop.definitionId)?.family ?? 'trash-can'
    }));
    const counts = new Map<string, number>();
    for (const candidate of candidates) {
      if ((counts.get(candidate.family) ?? 0) >= (quotas.get(candidate.family) ?? 0)) continue;
      const spacing = PROP_SPACING[candidate.family];
      if (placed.some((existing) => {
        const minimum = existing.family === candidate.family
          ? spacing
          : Math.min(64, spacing);
        return Math.hypot(existing.x - candidate.x, existing.y - candidate.y) < minimum;
      })) continue;
      const definition = streetPropDefinition(candidate.definitionId);
      if (!definition) continue;
      const prop = new StreetPropState();
      prop.id = `street-prop-${candidate.family}-${candidate.column}-${candidate.row}`;
      prop.definitionId = candidate.definitionId;
      prop.surfaceId = candidate.surfaceId;
      prop.x = candidate.x;
      prop.y = candidate.y;
      prop.angle = candidate.angle;
      prop.maxHealth = definition.maxHealth;
      prop.health = definition.maxHealth;
      this.addProp(prop);
      placed.push({x: prop.x, y: prop.y, family: candidate.family});
      counts.set(candidate.family, (counts.get(candidate.family) ?? 0) + 1);
    }
  }

  firstSegmentHit(
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    surfaceId: string,
    projectileRadius = 4
  ): StreetPropSegmentHit | undefined {
    let nearest: StreetPropSegmentHit | undefined;
    for (const prop of this.options.state.streetProps.values()) {
      if (prop.destroyed || prop.surfaceId !== surfaceId) continue;
      const definition = streetPropDefinition(prop.definitionId);
      if (!definition) continue;
      const progress = circleHitProgress(
        prop.x,
        prop.y,
        definition.hitRadius + projectileRadius,
        startX,
        startY,
        endX,
        endY
      );
      if (progress === undefined || (nearest && progress >= nearest.progress)) continue;
      nearest = {prop, progress};
    }
    return nearest;
  }

  damage(prop: StreetPropState, amount: number, angle: number, nowMs: number): boolean {
    if (prop.destroyed || amount <= 0) return false;
    prop.health = Math.max(0, prop.health - amount);
    prop.damageStage = streetPropDamageStage(prop.health, prop.maxHealth);
    prop.hitSequence++;
    prop.hitAngle = angle;
    if (prop.health === 0) {
      prop.destroyed = true;
      prop.resetAt = nowMs + RESET_DELAY_MS;
    }
    return true;
  }

  update(nowMs: number): void {
    this.updateVehicleImpacts(nowMs);
    for (const prop of this.options.state.streetProps.values()) {
      if (!prop.destroyed || prop.resetAt <= 0 || nowMs < prop.resetAt) continue;
      prop.health = prop.maxHealth;
      prop.damageStage = 0;
      prop.destroyed = false;
      prop.resetAt = 0;
    }
  }

  private updateVehicleImpacts(nowMs: number): void {
    const present = new Set<string>();
    for (const vehicle of this.options.state.vehicles.values()) {
      present.add(vehicle.id);
      const recordedPrevious = this.previousVehiclePositions.get(vehicle.id);
      const previous = recordedPrevious?.surfaceId === vehicle.surfaceId
        ? recordedPrevious
        : {x: vehicle.x, y: vehicle.y, surfaceId: vehicle.surfaceId};
      const speed = Math.hypot(vehicle.linvelX, vehicle.linvelY);
      const angle = Math.atan2(vehicle.linvelY, vehicle.linvelX);
      const hits = vehicle.destroyed
        ? []
        : this.propsAlongSegment(previous.x, previous.y, vehicle.x, vehicle.y)
          .flatMap((prop) => {
            if (prop.destroyed || prop.surfaceId !== vehicle.surfaceId) return [];
            const definition = streetPropDefinition(prop.definitionId);
            if (!definition) return [];
            const progress = circleHitProgress(
              prop.x,
              prop.y,
              definition.hitRadius + VEHICLE_RADIUS,
              previous.x,
              previous.y,
              vehicle.x,
              vehicle.y
            );
            return progress === undefined ? [] : [{prop, progress}];
          })
          .sort((left, right) => left.progress - right.progress);
      if (hits.length > 0) {
        if (speed >= VEHICLE_PROP_BREAK_SPEED) {
          for (const {prop} of hits) this.damage(prop, prop.maxHealth, angle, nowMs);
        } else {
          vehicle.x = previous.x;
          vehicle.y = previous.y;
          vehicle.speed = 0;
          vehicle.linvelX = 0;
          vehicle.linvelY = 0;
          vehicle.angvel *= 0.25;
          for (const player of this.options.state.players.values()) {
            if (player.vehicleId !== vehicle.id) continue;
            player.x = vehicle.x;
            player.y = vehicle.y;
            player.surfaceId = vehicle.surfaceId;
            if (player.vehicleSeat === 0) player.angle = vehicle.angle;
          }
        }
      }
      this.previousVehiclePositions.set(vehicle.id, {
        x: vehicle.x,
        y: vehicle.y,
        surfaceId: vehicle.surfaceId
      });
    }
    for (const id of this.previousVehiclePositions.keys()) {
      if (!present.has(id)) this.previousVehiclePositions.delete(id);
    }
  }

  private propsAlongSegment(
    startX: number,
    startY: number,
    endX: number,
    endY: number
  ): StreetPropState[] {
    const padding = VEHICLE_RADIUS + MAX_PROP_HIT_RADIUS;
    const minColumn = Math.floor((Math.min(startX, endX) - padding) / PROP_SPATIAL_CELL_SIZE);
    const maxColumn = Math.floor((Math.max(startX, endX) + padding) / PROP_SPATIAL_CELL_SIZE);
    const minRow = Math.floor((Math.min(startY, endY) - padding) / PROP_SPATIAL_CELL_SIZE);
    const maxRow = Math.floor((Math.max(startY, endY) + padding) / PROP_SPATIAL_CELL_SIZE);
    const props: StreetPropState[] = [];
    for (let row = minRow; row <= maxRow; row++) {
      for (let column = minColumn; column <= maxColumn; column++) {
        props.push(...(this.propSpatial.get(`${column}:${row}`) ?? []));
      }
    }
    return props;
  }

  private addProp(prop: StreetPropState): void {
    this.options.state.streetProps.set(prop.id, prop);
    this.indexProp(prop);
  }

  private indexProp(prop: StreetPropState): void {
    const column = Math.floor(prop.x / PROP_SPATIAL_CELL_SIZE);
    const row = Math.floor(prop.y / PROP_SPATIAL_CELL_SIZE);
    const key = `${column}:${row}`;
    const bucket = this.propSpatial.get(key) ?? [];
    bucket.push(prop);
    this.propSpatial.set(key, bucket);
  }

}

interface PropPlacementCandidate {
  column: number;
  row: number;
  x: number;
  y: number;
  surfaceId: string;
  definitionId: StreetPropDefinitionId;
  family: 'dumpster' | 'hydrant' | 'trash-can';
  angle: number;
  score: number;
}

function selectPropFamily(
  roadDistance: number,
  blockedNeighbors: number,
  seed: number
): PropPlacementCandidate['family'] | undefined {
  if (roadDistance === 1 && seed % 7 === 0) return 'hydrant';
  if (roadDistance >= 2 && blockedNeighbors > 0 && seed % 5 <= 1) return 'dumpster';
  if (roadDistance <= 2 && (blockedNeighbors > 0 || seed % 3 === 0)) return 'trash-can';
  return undefined;
}

function nearestRoadCell(
  world: CollisionMap,
  column: number,
  row: number,
  tileWidth: number,
  tileHeight: number,
  maxDistance: number
): {column: number; row: number; distance: number} | undefined {
  for (let distance = 1; distance <= maxDistance; distance++) {
    for (let offset = -distance; offset <= distance; offset++) {
      const candidates = [
        {column: column + offset, row: row - distance},
        {column: column + offset, row: row + distance},
        {column: column - distance, row: row + offset},
        {column: column + distance, row: row + offset}
      ];
      for (const candidate of candidates) {
        const x = (candidate.column + 0.5) * tileWidth;
        const y = (candidate.row + 0.5) * tileHeight;
        if (world.isRoadAt(x, y)) return {...candidate, distance};
      }
    }
  }
  return undefined;
}

function adjacentBlockedCount(
  collisions: readonly number[],
  width: number,
  height: number,
  column: number,
  row: number
): number {
  return [
    [column - 1, row],
    [column + 1, row],
    [column, row - 1],
    [column, row + 1]
  ].filter(([candidateColumn, candidateRow]) => (
    candidateColumn < 0 || candidateRow < 0 || candidateColumn >= width || candidateRow >= height ||
    collisions[candidateRow * width + candidateColumn] !== 0
  )).length;
}

function placementHash(column: number, row: number, width: number, height: number): number {
  let value = Math.imul(column + 1, 0x9e3779b1) ^ Math.imul(row + 1, 0x85ebca6b);
  value ^= Math.imul(width, 0xc2b2ae35) ^ Math.imul(height, 0x27d4eb2f);
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15;
  return value >>> 0;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
