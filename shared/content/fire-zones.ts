export const FIRE_ZONE = Object.freeze({
  radius: 76,
  durationMs: 6000,
  damageIntervalMs: 500,
  playerDamage: 6,
  npcDamage: 9,
  vehicleDamage: 24,
  globalCapacity: 24,
  ownerCapacity: 3
});

export const MOLOTOV_PROJECTILE = Object.freeze({
  fuseMs: 2000,
  planarSpeed: 285,
  initialHeight: 10,
  verticalSpeed: 165,
  gravity: 420,
  radius: 5,
  globalCapacity: 24,
  ownerCapacity: 2
});
