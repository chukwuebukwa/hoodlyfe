export interface VehicleDamageResult {
  appliedDamage: number;
  health: number;
  destroyed: boolean;
}

export class VehicleDamageSystem {
  apply(health: number, damage: number): VehicleDamageResult {
    const safeHealth = Math.max(0, health);
    const nextHealth = Math.max(0, safeHealth - Math.max(0, Math.round(damage)));
    return {
      appliedDamage: safeHealth - nextHealth,
      health: nextHealth,
      destroyed: safeHealth > 0 && nextHealth === 0
    };
  }

  wallImpactDamage(speed: number): number {
    return Math.max(0, Math.round((Math.abs(speed) - 70) * 0.09));
  }

  weaponDamage(baseDamage: number, pellets: number): number {
    const scale = pellets > 1 ? 0.24 : 0.45;
    return Math.max(1, Math.round(baseDamage * scale));
  }

  speedMultiplier(health: number, maxHealth: number): number {
    const ratio = maxHealth <= 0 ? 0 : Math.max(0, Math.min(1, health / maxHealth));
    if (ratio <= 0) return 0;
    return 0.55 + ratio * 0.45;
  }
}
