import type {DistrictNetworkState} from '../types.ts';
import {projectMissionWorld} from './mission-presentation-policy.ts';

export interface ObjectiveTarget {
  id: string;
  x: number;
  y: number;
  kind: 'race' | 'delivery' | 'checkpoint' | 'hold' | 'target';
}

export interface ObjectiveArrowPose {
  x: number;
  y: number;
  angle: number;
  distance: number;
}

const OBJECTIVE_ARROW_RADIUS = 52;
const OBJECTIVE_REACHED_DISTANCE = 34;

export function activeObjectiveTarget(
  state: DistrictNetworkState,
  localPlayerId: string
): ObjectiveTarget | undefined {
  const raceEntrant = state.race?.entrants?.get(localPlayerId);
  if (raceEntrant && !raceEntrant.finished && raceEntrant.nextCheckpointRadius > 0) {
    return {
      id: `race:${state.race?.raceNumber ?? 0}:${raceEntrant.checkpointIndex}`,
      x: raceEntrant.nextCheckpointX,
      y: raceEntrant.nextCheckpointY,
      kind: 'race'
    };
  }
  if (state.race?.trackId) return undefined;

  const mission = projectMissionWorld(state, localPlayerId);
  if (mission.delivery) {
    return {id: 'mission:delivery', x: mission.delivery.x, y: mission.delivery.y, kind: 'delivery'};
  }
  if (mission.checkpoint) {
    return {
      id: 'mission:checkpoint',
      x: mission.checkpoint.x,
      y: mission.checkpoint.y,
      kind: 'checkpoint'
    };
  }
  if (mission.hold) {
    return {id: 'mission:hold', x: mission.hold.x, y: mission.hold.y, kind: 'hold'};
  }
  if (mission.target) {
    return {id: 'mission:target', x: mission.target.x, y: mission.target.y, kind: 'target'};
  }
  return undefined;
}

export function objectiveArrowPose(
  origin: {x: number; y: number},
  target: {x: number; y: number},
  radius = OBJECTIVE_ARROW_RADIUS
): ObjectiveArrowPose | undefined {
  const deltaX = target.x - origin.x;
  const deltaY = target.y - origin.y;
  const distance = Math.hypot(deltaX, deltaY);
  if (distance <= OBJECTIVE_REACHED_DISTANCE) return undefined;
  const angle = Math.atan2(deltaY, deltaX);
  return {
    x: origin.x + Math.cos(angle) * radius,
    y: origin.y + Math.sin(angle) * radius,
    angle,
    distance
  };
}
