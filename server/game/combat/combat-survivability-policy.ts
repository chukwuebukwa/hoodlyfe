export type DamageFamily = 'bullet' | 'melee' | 'explosion' | 'vehicle' | 'environment';
export type ImpactForce = 'light' | 'medium' | 'heavy';
export type ReactionKind = '' | 'flinch' | 'stagger' | 'knockdown';
export type ReactionDirection = 'front' | 'left' | 'back' | 'right';

export interface DamageImpact {
  family: DamageFamily;
  force: ImpactForce;
  sourceX: number;
  sourceY: number;
  bypassArmor?: boolean;
}

export interface DamageResolution {
  acceptedDamage: number;
  armorDamage: number;
  healthDamage: number;
  remainingArmor: number;
  remainingHealth: number;
}

export interface ReactionInput {
  family: DamageFamily;
  force: ImpactForce;
  acceptedDamage: number;
  previousHealth: number;
  remainingHealth: number;
}

const REACTION_DURATION_MS: Readonly<Record<Exclude<ReactionKind, ''>, number>> = Object.freeze({
  flinch: 220,
  stagger: 420,
  knockdown: 950
});

export function resolveDamage(
  health: number,
  armor: number,
  amount: number,
  bypassArmor = false
): DamageResolution {
  const previousHealth = Math.max(0, finite(health));
  const previousArmor = Math.max(0, finite(armor));
  const accepted = Math.max(0, finite(amount));
  const armorDamage = bypassArmor ? 0 : Math.min(previousArmor, accepted);
  const healthDamage = Math.min(previousHealth, accepted - armorDamage);
  return {
    acceptedDamage: armorDamage + healthDamage,
    armorDamage,
    healthDamage,
    remainingArmor: previousArmor - armorDamage,
    remainingHealth: previousHealth - healthDamage
  };
}

export function impactDirection(
  targetX: number,
  targetY: number,
  targetAngle: number,
  sourceX: number,
  sourceY: number
): ReactionDirection {
  const sourceAngle = Math.atan2(sourceY - targetY, sourceX - targetX);
  const relative = normalizeAngle(sourceAngle - targetAngle);
  if (relative >= -Math.PI / 4 && relative < Math.PI / 4) return 'front';
  if (relative >= Math.PI / 4 && relative < Math.PI * 3 / 4) return 'right';
  if (relative <= -Math.PI / 4 && relative > -Math.PI * 3 / 4) return 'left';
  return 'back';
}

export function reactionKindFor(input: ReactionInput): Exclude<ReactionKind, ''> {
  const crossedCriticalHealth = input.previousHealth > 20 && input.remainingHealth <= 20;
  if (
    input.force === 'heavy' ||
    input.family === 'explosion' ||
    input.family === 'vehicle' ||
    crossedCriticalHealth
  ) {
    return 'knockdown';
  }
  if (input.force === 'medium' || input.acceptedDamage >= 24) return 'stagger';
  return 'flinch';
}

export function reactionDurationMs(kind: Exclude<ReactionKind, ''>): number {
  return REACTION_DURATION_MS[kind];
}

export function reactionPriority(kind: ReactionKind): number {
  if (kind === 'knockdown') return 3;
  if (kind === 'stagger') return 2;
  if (kind === 'flinch') return 1;
  return 0;
}

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function normalizeAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}
