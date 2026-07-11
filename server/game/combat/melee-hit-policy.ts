import type {MeleeStrikeDefinition} from '../../../shared/content/weapon-catalog.ts';

export type MeleeTargetKind = 'player' | 'npc' | 'vehicle';

export interface MeleeTargetCandidate {
  id: string;
  kind: MeleeTargetKind;
  x: number;
  y: number;
  radius: number;
  lineOfSight: boolean;
  targetable?: boolean;
}

export interface RankedMeleeTarget extends MeleeTargetCandidate {
  distance: number;
  angleError: number;
  score: number;
}

export function selectMeleeTargets(
  originX: number,
  originY: number,
  angle: number,
  strike: MeleeStrikeDefinition,
  candidates: readonly MeleeTargetCandidate[]
): RankedMeleeTarget[] {
  const ranked = candidates
    .map((candidate) => rankCandidate(originX, originY, angle, strike, candidate))
    .filter((candidate): candidate is RankedMeleeTarget => Boolean(candidate))
    .sort((left, right) => (
      left.score - right.score ||
      targetKindOrder(left.kind) - targetKindOrder(right.kind) ||
      left.id.localeCompare(right.id)
    ));

  const rankedVehicles = ranked.filter((candidate) => candidate.kind === 'vehicle');
  const pedestrians = ranked
    .filter((candidate) => (
      candidate.kind !== 'vehicle' &&
      !occludedByVehicle(originX, originY, candidate, rankedVehicles)
    ))
    .slice(0, strike.maxPedTargets);
  const vehicles = rankedVehicles
    .filter((candidate) => candidate.targetable !== false)
    .slice(0, strike.maxVehicleTargets);
  return [...pedestrians, ...vehicles].sort((left, right) => (
    left.score - right.score ||
    targetKindOrder(left.kind) - targetKindOrder(right.kind) ||
    left.id.localeCompare(right.id)
  ));
}

function occludedByVehicle(
  originX: number,
  originY: number,
  target: RankedMeleeTarget,
  vehicles: readonly RankedMeleeTarget[]
): boolean {
  const segmentX = target.x - originX;
  const segmentY = target.y - originY;
  const lengthSquared = segmentX * segmentX + segmentY * segmentY;
  if (lengthSquared <= 0.0001) return false;
  return vehicles.some((vehicle) => {
    const progress = (
      (vehicle.x - originX) * segmentX +
      (vehicle.y - originY) * segmentY
    ) / lengthSquared;
    if (progress <= 0 || progress >= 1) return false;
    const closestX = originX + segmentX * progress;
    const closestY = originY + segmentY * progress;
    const clearance = Math.max(0, vehicle.radius - target.radius * 0.2);
    return Math.hypot(vehicle.x - closestX, vehicle.y - closestY) < clearance;
  });
}

function rankCandidate(
  originX: number,
  originY: number,
  angle: number,
  strike: MeleeStrikeDefinition,
  candidate: MeleeTargetCandidate
): RankedMeleeTarget | undefined {
  if (!candidate.lineOfSight || candidate.radius < 0) return undefined;
  const deltaX = candidate.x - originX;
  const deltaY = candidate.y - originY;
  const centerDistance = Math.hypot(deltaX, deltaY);
  const contactDistance = Math.max(0, centerDistance - candidate.radius);
  if (contactDistance > strike.range) return undefined;

  const targetAngle = centerDistance <= 0.0001 ? angle : Math.atan2(deltaY, deltaX);
  const angleError = Math.abs(shortestAngle(targetAngle - angle));
  const radiusAllowance = centerDistance <= candidate.radius
    ? Math.PI
    : Math.asin(Math.min(1, candidate.radius / centerDistance));
  if (angleError > strike.halfArcRadians + radiusAllowance) return undefined;

  return {
    ...candidate,
    distance: centerDistance,
    angleError,
    score: contactDistance + angleError * 28
  };
}

function shortestAngle(value: number): number {
  return Math.atan2(Math.sin(value), Math.cos(value));
}

function targetKindOrder(kind: MeleeTargetKind): number {
  if (kind === 'player') return 0;
  if (kind === 'npc') return 1;
  return 2;
}
