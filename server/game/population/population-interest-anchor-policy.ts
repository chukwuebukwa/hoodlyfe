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
}

export interface PopulationPlayerObserver {
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
    anchors.push(...populationInterestAnchorsFor({...player, speed: 0}));
    if (!player.vehicleId || projectedVehicles.has(player.vehicleId)) continue;
    const vehicle = vehicleForId(player.vehicleId);
    if (!vehicle) continue;
    projectedVehicles.add(player.vehicleId);
    anchors.push(
      ...populationInterestAnchorsFor(vehicle)
        .filter((anchor) => anchor.kind === 'lookahead')
    );
  }
  return anchors;
}

export function populationInterestAnchorsFor(
  observer: PopulationInterestObserver
): PopulationInterestAnchor[] {
  if (!validObserver(observer)) return [];
  const anchors: PopulationInterestAnchor[] = [{
    x: observer.x,
    y: observer.y,
    kind: 'player',
    protectsVisibility: true
  }];
  if (Math.abs(observer.speed) < POPULATION_LOOKAHEAD.minimumVehicleSpeed) return anchors;

  const projectedDistance = clamp(
    observer.speed * POPULATION_LOOKAHEAD.projectionSeconds,
    -POPULATION_LOOKAHEAD.maximumDistance,
    POPULATION_LOOKAHEAD.maximumDistance
  );
  anchors.push({
    x: observer.x + Math.cos(observer.angle) * projectedDistance,
    y: observer.y + Math.sin(observer.angle) * projectedDistance,
    kind: 'lookahead',
    protectsVisibility: false
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
