import {readFile, readdir} from 'node:fs/promises';
import path from 'node:path';
import {
  VEHICLE_SOURCE_FRAMES,
  type VehicleSourceFrame,
  type VehicleWorkshopManifest
} from '../../../shared/content/vehicle-workshop.ts';

export const VEHICLE_SOURCE_ROOT = path.resolve('public/assets/custom/vehicles');
export const VEHICLE_GENERATED_CATALOG = path.resolve('shared/content/vehicle-catalog.generated.json');
export const VEHICLE_DOOR_ATLAS = path.resolve('public/assets/custom/actions/vehicle-doors.png');

const VEHICLE_ID_PATTERN = /^[a-z][a-z0-9-]*$/;

export async function loadVehicleManifests(
  sourceRoot = VEHICLE_SOURCE_ROOT
): Promise<VehicleWorkshopManifest[]> {
  const entries = await readdir(sourceRoot, {withFileTypes: true});
  const manifests: VehicleWorkshopManifest[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue;
    const manifestPath = path.join(sourceRoot, entry.name, 'vehicle.json');
    let raw: unknown;
    try {
      raw = JSON.parse(await readFile(manifestPath, 'utf8')) as unknown;
    } catch (error) {
      if (isMissingFile(error)) continue;
      throw error;
    }
    const manifest = parseVehicleManifest(raw, manifestPath);
    if (manifest.id !== entry.name) {
      throw new Error(`${manifestPath}: id "${manifest.id}" must match its folder name "${entry.name}".`);
    }
    manifests.push(manifest);
  }
  return manifests;
}

export function parseVehicleManifest(raw: unknown, source = 'vehicle.json'): VehicleWorkshopManifest {
  if (!isRecord(raw)) throw new Error(`${source}: expected an object.`);
  if (raw.version !== 1) throw new Error(`${source}: version must be 1.`);
  const id = stringField(raw, 'id', source);
  if (!VEHICLE_ID_PATTERN.test(id)) {
    throw new Error(`${source}: id must use lowercase letters, numbers, and hyphens.`);
  }
  const status = raw.status;
  if (status !== 'draft' && status !== 'ready') throw new Error(`${source}: invalid status.`);
  const vehicleClass = raw.class;
  if (vehicleClass !== 'civilian' && vehicleClass !== 'service' && vehicleClass !== 'emergency') {
    throw new Error(`${source}: invalid class.`);
  }

  const collision = recordField(raw, 'collision', source);
  const handling = recordField(raw, 'handling', source);
  const traffic = recordField(raw, 'traffic', source);
  const population = recordField(raw, 'population', source);
  const presentation = recordField(raw, 'presentation', source);
  const generation = recordField(raw, 'generation', source);
  const offsets = recordField(presentation, 'offsets', source);

  const manifest: VehicleWorkshopManifest = {
    version: 1,
    id,
    label: stringField(raw, 'label', source),
    status,
    class: vehicleClass,
    seats: numberField(raw, 'seats', source, 1),
    radius: numberField(raw, 'radius', source, 1),
    maxHealth: numberField(raw, 'maxHealth', source, 1),
    mass: numberField(raw, 'mass', source, 0.01),
    collisionDamageScale: numberField(raw, 'collisionDamageScale', source, 0),
    collision: {
      length: numberField(collision, 'length', source, 1),
      width: numberField(collision, 'width', source, 1)
    },
    handling: {
      forwardAcceleration: numberField(handling, 'forwardAcceleration', source, 0),
      reverseAcceleration: numberField(handling, 'reverseAcceleration', source, 0),
      coastDeceleration: numberField(handling, 'coastDeceleration', source, 0),
      brakeDeceleration: numberField(handling, 'brakeDeceleration', source, 0),
      maximumForwardSpeed: numberField(handling, 'maximumForwardSpeed', source, 0),
      maximumReverseSpeed: numberField(handling, 'maximumReverseSpeed', source, 0),
      steeringRate: numberField(handling, 'steeringRate', source, 0),
      steeringGripFloor: numberField(handling, 'steeringGripFloor', source, 0),
      steeringGripSpeed: numberField(handling, 'steeringGripSpeed', source, 0),
      lateralGrip: numberField(handling, 'lateralGrip', source, 0),
      handbrakeLateralGrip: numberField(handling, 'handbrakeLateralGrip', source, 0),
      yawResponse: numberField(handling, 'yawResponse', source, 0),
      handbrakeTurnMultiplier: numberField(handling, 'handbrakeTurnMultiplier', source, 0),
      powerOversteer: numberField(handling, 'powerOversteer', source, 0)
    },
    traffic: {
      cruiseSpeed: numberField(traffic, 'cruiseSpeed', source, 0),
      acceleration: numberField(traffic, 'acceleration', source, 0),
      brakeDeceleration: numberField(traffic, 'brakeDeceleration', source, 0),
      minimumGap: numberField(traffic, 'minimumGap', source, 0),
      followingTime: numberField(traffic, 'followingTime', source, 0),
      pedestrianGap: numberField(traffic, 'pedestrianGap', source, 0),
      lookAhead: numberField(traffic, 'lookAhead', source, 0)
    },
    population: {
      parked: booleanField(population, 'parked', source),
      ambientTraffic: booleanField(population, 'ambientTraffic', source),
      weight: numberField(population, 'weight', source, 0)
    },
    presentation: {
      atlasRow: integerField(presentation, 'atlasRow', source, 0),
      width: numberField(presentation, 'width', source, 1),
      height: numberField(presentation, 'height', source, 1),
      emergencyLights: booleanField(presentation, 'emergencyLights', source),
      offsets: Object.fromEntries(VEHICLE_SOURCE_FRAMES.map((frame) => {
        const offset = recordField(offsets, frame, source);
        return [frame, {
          x: finiteNumberField(offset, 'x', source),
          y: finiteNumberField(offset, 'y', source)
        }];
      })) as Record<VehicleSourceFrame, {x: number; y: number}>
    },
    generation: {
      prompt: stringField(generation, 'prompt', source, true),
      model: stringField(generation, 'model', source),
      ...(typeof generation.updatedAt === 'string' ? {updatedAt: generation.updatedAt} : {})
    }
  };
  return manifest;
}

export function validateReadyManifestSet(manifests: VehicleWorkshopManifest[]): string[] {
  const ready = manifests.filter((manifest) => manifest.status === 'ready');
  const issues: string[] = [];
  const ids = new Set<string>();
  const rows = new Set<number>();
  for (const manifest of ready) {
    if (ids.has(manifest.id)) issues.push(`Duplicate vehicle id: ${manifest.id}.`);
    if (rows.has(manifest.presentation.atlasRow)) {
      issues.push(`Duplicate atlas row: ${manifest.presentation.atlasRow}.`);
    }
    ids.add(manifest.id);
    rows.add(manifest.presentation.atlasRow);
  }
  const orderedRows = [...rows].sort((a, b) => a - b);
  const expectedRows = Array.from({length: ready.length}, (_, index) => index);
  if (orderedRows.join(',') !== expectedRows.join(',')) {
    issues.push(`Ready atlas rows must be contiguous ${expectedRows.join(',')}; got ${orderedRows.join(',')}.`);
  }
  return issues;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function recordField(record: Record<string, unknown>, key: string, source: string): Record<string, unknown> {
  const value = record[key];
  if (!isRecord(value)) throw new Error(`${source}: ${key} must be an object.`);
  return value;
}

function stringField(
  record: Record<string, unknown>,
  key: string,
  source: string,
  allowEmpty = false
): string {
  const value = record[key];
  if (typeof value !== 'string' || (!allowEmpty && value.trim() === '')) {
    throw new Error(`${source}: ${key} must be ${allowEmpty ? 'a string' : 'a non-empty string'}.`);
  }
  return value;
}

function numberField(
  record: Record<string, unknown>,
  key: string,
  source: string,
  minimum: number
): number {
  const value = finiteNumberField(record, key, source);
  if (value < minimum) throw new Error(`${source}: ${key} must be at least ${minimum}.`);
  return value;
}

function integerField(
  record: Record<string, unknown>,
  key: string,
  source: string,
  minimum: number
): number {
  const value = numberField(record, key, source, minimum);
  if (!Number.isInteger(value)) throw new Error(`${source}: ${key} must be an integer.`);
  return value;
}

function finiteNumberField(record: Record<string, unknown>, key: string, source: string): number {
  const value = record[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${source}: ${key} must be a finite number.`);
  }
  return value;
}

function booleanField(record: Record<string, unknown>, key: string, source: string): boolean {
  const value = record[key];
  if (typeof value !== 'boolean') throw new Error(`${source}: ${key} must be a boolean.`);
  return value;
}

function isMissingFile(error: unknown): boolean {
  return isRecord(error) && error.code === 'ENOENT';
}
