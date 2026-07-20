import type {PopulationInterestAnchor} from './population-activation-policy.ts';

export const POPULATION_LOOKAHEAD = Object.freeze({
  minimumVehicleSpeed: 120,
  projectionSeconds: 1.5,
  maximumDistance: 480
});

export interface PopulationInterestObserver {
  x: number;
  y: number;
  angle: number;
  speed: number;
  linvelX?: number;
  linvelY?: number;
}

export interface PopulationPlayerObserver {
  id: string;
  x: number;
  y: number;
  angle: number;
  vehicleId: string;
}

export interface PopulationVehicleObserver extends PopulationInterestObserver {
  id: string;
}

export function populationInterestAnchorsForPlayers(
  players: readonly PopulationPlayerObserver[],
  vehicleForId: (vehicleId: string) => PopulationVehicleObserver | undefined
): PopulationInterestAnchor[] {
  const anchors: PopulationInterestAnchor[] = [];
  const projectedVehicles = new Set<string>();
  for (const player of players) {
    anchors.push(...populationInterestAnchorsFor({...player, speed: 0}, player.id));
    if (!player.vehicleId || projectedVehicles.has(player.vehicleId)) continue;
    const vehicle = vehicleForId(player.vehicleId);
    if (!vehicle) continue;
    projectedVehicles.add(player.vehicleId);
    anchors.push(
      ...populationInterestAnchorsFor(vehicle, player.id)
        .filter((anchor) => anchor.kind === 'lookahead')
    );
  }
  return anchors;
}

export function populationInterestAnchorsFor(
  observer: PopulationInterestObserver,
  ownerId?: string
): PopulationInterestAnchor[] {
  if (!validObserver(observer)) return [];
  const anchors: PopulationInterestAnchor[] = [{
    x: observer.x,
    y: observer.y,
    kind: 'player',
    protectsVisibility: true,
    ...(ownerId ? {ownerId} : {})
  }];
  const hasVelocity = Number.isFinite(observer.linvelX) && Number.isFinite(observer.linvelY);
  const velocityX = hasVelocity ? observer.linvelX! : Math.cos(observer.angle) * observer.speed;
  const velocityY = hasVelocity ? observer.linvelY! : Math.sin(observer.angle) * observer.speed;
  const motionSpeed = Math.hypot(velocityX, velocityY);
  if (motionSpeed < POPULATION_LOOKAHEAD.minimumVehicleSpeed) return anchors;

  const projectedDistance = clamp(
    motionSpeed * POPULATION_LOOKAHEAD.projectionSeconds,
    0,
    POPULATION_LOOKAHEAD.maximumDistance
  );
  anchors.push({
    x: observer.x + velocityX / motionSpeed * projectedDistance,
    y: observer.y + velocityY / motionSpeed * projectedDistance,
    kind: 'lookahead',
    protectsVisibility: false,
    ...(ownerId ? {ownerId} : {})
  });
  return anchors;
}

function validObserver(observer: PopulationInterestObserver): boolean {
  return Number.isFinite(observer.x) && Number.isFinite(observer.y) &&
    Number.isFinite(observer.angle) && Number.isFinite(observer.speed);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
