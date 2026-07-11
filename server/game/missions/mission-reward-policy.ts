export function vehicleCondition(health: number, maximumHealth: number): number {
  if (!Number.isFinite(health) || !Number.isFinite(maximumHealth) || maximumHealth <= 0) return 0;
  return Math.max(0, Math.min(1, health / maximumHealth));
}

export function conditionReward(baseReward: number, condition: number): number {
  const boundedBase = Number.isFinite(baseReward) ? Math.max(0, Math.floor(baseReward)) : 0;
  const boundedCondition = Number.isFinite(condition) ? Math.max(0, Math.min(1, condition)) : 0;
  return Math.floor(boundedBase * (0.35 + boundedCondition * 0.65));
}
