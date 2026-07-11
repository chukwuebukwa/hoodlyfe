import type {MinimapPointInput} from '../minimap-marker-policy.ts';
import type {NetworkCashPickup} from '../types.ts';

export function cashPickupLabel(amount: number): string {
  return `$${Math.max(0, Math.floor(amount))}`;
}

export function cashPickupMinimapPoints(
  pickups?: Iterable<NetworkCashPickup>
): MinimapPointInput[] {
  return [...pickups ?? []]
    .filter((pickup) => pickup.amount > 0)
    .map((pickup) => ({
      id: pickup.id,
      kind: 'cash' as const,
      x: pickup.x,
      y: pickup.y
    }));
}
