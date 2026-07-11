export type ExplosionKind = 'grenade' | 'rocket' | 'vehicle';

export interface ExplosionPolicy {
  radius: number;
  maximumPedestrianDamage: number;
  maximumVehicleDamage: number;
  visualLifetimeMs: number;
}

export const GRENADE_PROJECTILE = Object.freeze({
  fuseMs: 2000,
  planarSpeed: 300,
  initialHeight: 10,
  verticalSpeed: 190,
  gravity: 420,
  wallElasticity: 0.48,
  groundElasticity: 0.42,
  groundDamping: 0.74,
  radius: 5,
  globalCapacity: 24,
  ownerCapacity: 2
});

export const ROCKET_PROJECTILE = Object.freeze({
  radius: 7,
  globalCapacity: 32,
  ownerCapacity: 2,
  spawnOffset: 25,
  collisionStep: 7
});

export const EXPLOSION_POLICIES: Readonly<Record<ExplosionKind, ExplosionPolicy>> = Object.freeze({
  grenade: Object.freeze({
    radius: 130,
    maximumPedestrianDamage: 120,
    maximumVehicleDamage: 650,
    visualLifetimeMs: 650
  }),
  rocket: Object.freeze({
    radius: 155,
    maximumPedestrianDamage: 165,
    maximumVehicleDamage: 820,
    visualLifetimeMs: 720
  }),
  vehicle: Object.freeze({
    radius: 170,
    maximumPedestrianDamage: 150,
    maximumVehicleDamage: 900,
    visualLifetimeMs: 850
  })
});

export const EXPLOSION_VISUAL_CAPACITY = 32;

export function blastFalloff(distance: number, radius: number): number {
  if (!Number.isFinite(distance) || !Number.isFinite(radius) || radius <= 0 || distance >= radius) {
    return 0;
  }
  return Math.min(1, Math.max(0, (radius - Math.max(0, distance)) * 2 / radius));
}
