import type {MinimapPointInput} from '../minimap-marker-policy.ts';
import type {NetworkWeaponPickup} from '../types.ts';

export function weaponPickupMinimapPoints(
  pickups?: Iterable<NetworkWeaponPickup>
): MinimapPointInput[] {
  return [...pickups ?? []]
    .filter((pickup) => pickup.available)
    .map((pickup) => ({
      id: pickup.id,
      kind: 'pickup' as const,
      x: pickup.x,
      y: pickup.y
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
}
