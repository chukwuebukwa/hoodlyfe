export const NPC_MELEE = Object.freeze({
  engageDistance: 52,
  durationMs: 520,
  impactMs: 210,
  recoveryCooldownMs: 420,
  damage: 8,
  halfArcRadians: 0.72
});

export const NPC_MELEE_IMPACT_PROGRESS = NPC_MELEE.impactMs / NPC_MELEE.durationMs;
