export interface PoliceFireDiscipline {
  authorized: boolean;
  cooldownMs: number;
  maximumRange: number;
  maximumAngularError: number;
}

interface PoliceMarksmanshipTier {
  cooldownMs: number;
  maximumRange: number;
  nearError: number;
  farError: number;
}

const TIERS: readonly PoliceMarksmanshipTier[] = [
  {cooldownMs: Number.POSITIVE_INFINITY, maximumRange: 0, nearError: 0, farError: 0},
  {cooldownMs: Number.POSITIVE_INFINITY, maximumRange: 0, nearError: 0, farError: 0},
  {cooldownMs: 1_250, maximumRange: 330, nearError: 0.08, farError: 0.28},
  {cooldownMs: 980, maximumRange: 380, nearError: 0.055, farError: 0.2},
  {cooldownMs: 800, maximumRange: 410, nearError: 0.035, farError: 0.14},
  {cooldownMs: 680, maximumRange: 430, nearError: 0.02, farError: 0.09}
];

/** Pure escalation policy; bullet authority and deterministic random ownership stay elsewhere. */
export function policeFireDiscipline(
  wantedLevel: number,
  targetDistance: number
): PoliceFireDiscipline {
  const tier = TIERS[Math.max(0, Math.min(5, Math.floor(wantedLevel)))];
  const distance = Math.max(0, Number.isFinite(targetDistance) ? targetDistance : 0);
  if (tier.maximumRange <= 0 || distance > tier.maximumRange) {
    return {
      authorized: false,
      cooldownMs: tier.cooldownMs,
      maximumRange: tier.maximumRange,
      maximumAngularError: tier.farError
    };
  }
  const distanceRatio = Math.min(1, distance / tier.maximumRange);
  return {
    authorized: true,
    cooldownMs: tier.cooldownMs,
    maximumRange: tier.maximumRange,
    maximumAngularError: tier.nearError + (tier.farError - tier.nearError) * distanceRatio
  };
}

export function applyPoliceAimError(
  idealAngle: number,
  maximumAngularError: number,
  randomUnit: number
): number {
  const unit = Math.max(0, Math.min(1, Number.isFinite(randomUnit) ? randomUnit : 0.5));
  return idealAngle + (unit * 2 - 1) * Math.max(0, maximumAngularError);
}
