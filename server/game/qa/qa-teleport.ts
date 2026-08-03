import {INTERIORS, STREET_SPACE_ID} from '../../../shared/content/interior-catalog.ts';
import {
  DEFAULT_SEAMLESS_INTERIOR_CATALOG,
  type SeamlessInteriorCatalog,
  type SeamlessInteriorDefinition
} from '../../../shared/content/seamless-interior-catalog.ts';
import type {QaTeleportDestinationId} from '../../../shared/protocol/qa-teleport.ts';
import {STREET_GROUND_SURFACE_ID} from '../../../shared/world/surface-map.ts';
import type {CollisionMap, SurfacePosition} from '../../world-map.ts';

export interface QaTeleportTarget extends SurfacePosition {
  readonly angle: number;
  readonly spaceId: string;
}

export function resolveQaTeleportTarget(
  destinationId: QaTeleportDestinationId,
  world: CollisionMap,
  playerIndex: number,
  radius: number,
  seamlessInteriors: SeamlessInteriorCatalog = DEFAULT_SEAMLESS_INTERIOR_CATALOG
): QaTeleportTarget | undefined {
  if (destinationId === 'spawn') {
    return {...world.spawnFor(playerIndex, radius), angle: -Math.PI / 2, spaceId: STREET_SPACE_ID};
  }

  const seamless = seamlessInteriors.interior(destinationId);
  if (seamless) return seamlessTarget(seamless, world, radius);

  const interior = INTERIORS.find(({id}) => id === destinationId);
  if (!interior) return undefined;
  return {
    x: interior.entry.x,
    y: interior.entry.y,
    angle: interior.entry.angle,
    spaceId: interior.id,
    surfaceId: STREET_GROUND_SURFACE_ID
  };
}

function seamlessTarget(
  interior: SeamlessInteriorDefinition,
  world: CollisionMap,
  radius: number
): QaTeleportTarget | undefined {
  const inward = entranceInwardVector(interior.entrance.side);
  const x = interior.entrance.x + inward.x * (radius + 18);
  const y = interior.entrance.y + inward.y * (radius + 18);
  const surfaceId = world.surfaces.surfaceIdsAt(x, y, 'player')
    .find((candidate) => world.canOccupy(x, y, radius, candidate, 'player'));
  if (!surfaceId) return undefined;
  return {x, y, angle: 0, spaceId: STREET_SPACE_ID, surfaceId};
}

function entranceInwardVector(
  side: SeamlessInteriorDefinition['entrance']['side']
): {x: number; y: number} {
  if (side === 'north') return {x: 0, y: 1};
  if (side === 'east') return {x: -1, y: 0};
  if (side === 'south') return {x: 0, y: -1};
  return {x: 1, y: 0};
}
