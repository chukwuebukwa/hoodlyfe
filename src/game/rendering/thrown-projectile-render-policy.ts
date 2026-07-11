import type {NetworkThrownProjectile} from '../types.ts';

export interface ThrownProjectilePresentation {
  texture: string;
  modelY: number;
  modelScale: number;
  shadowScale: number;
  shadowAlpha: number;
}

export function thrownProjectilePresentation(
  projectile: NetworkThrownProjectile,
  nowMs: number
): ThrownProjectilePresentation {
  const fuseProgress = clamp(
    1 - (projectile.fuseAt - nowMs) / Math.max(1, projectile.fuseAt - projectile.createdAt),
    0,
    1
  );
  const pulse = fuseProgress > 0.68 ? Math.sin(nowMs / 55) * 0.08 : 0;
  return {
    texture: `weapon-${projectile.kind}`,
    modelY: -Math.max(0, projectile.height),
    modelScale: (projectile.kind === 'molotov' ? 0.76 : 0.58) + (projectile.kind === 'grenade' ? pulse : 0),
    shadowScale: clamp(1 - projectile.height / 260, 0.42, 1),
    shadowAlpha: clamp(0.48 - projectile.height / 520, 0.16, 0.48)
  };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
