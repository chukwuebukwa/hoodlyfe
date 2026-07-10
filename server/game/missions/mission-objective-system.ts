import type {
  ActiveMissionPhase,
  MissionObjectiveDefinition,
  MissionTemplateDefinition
} from '../../../shared/content/mission-catalog.ts';

export interface MissionCheckpoint {
  id: string;
  x: number;
  y: number;
  radius: number;
}

export interface MissionObjectiveContext {
  targetOccupiedByCrew: boolean;
  teamWantedLevel: number;
  targetX: number;
  targetY: number;
  targetSpeed: number;
  deliveryX: number;
  deliveryY: number;
  deliveryRadius: number;
  checkpoints: readonly MissionCheckpoint[];
}

export interface MissionObjectiveProgress {
  objectiveIndex: number;
  checkpointIndex: number;
}

export type MissionObjectiveAdvance =
  | {
      status: 'active';
      objective: MissionObjectiveDefinition;
      phase: ActiveMissionPhase;
      objectiveIndex: number;
      checkpointIndex: number;
    }
  | {
      status: 'completed';
      objectiveIndex: number;
      checkpointIndex: number;
    };

interface ObjectiveEvaluation {
  status: 'active' | 'completed';
  phase: ActiveMissionPhase;
  checkpointIndex: number;
}

export function advanceMissionObjectives(
  template: MissionTemplateDefinition,
  progress: MissionObjectiveProgress,
  context: MissionObjectiveContext
): MissionObjectiveAdvance {
  let objectiveIndex = boundedIndex(progress.objectiveIndex, template.objectives.length);
  let checkpointIndex = boundedIndex(progress.checkpointIndex, context.checkpoints.length);
  while (objectiveIndex < template.objectives.length) {
    const objective = template.objectives[objectiveIndex];
    const evaluation = evaluateMissionObjective(objective, context, checkpointIndex);
    checkpointIndex = evaluation.checkpointIndex;
    if (evaluation.status === 'active') {
      return {
        status: 'active',
        objective,
        phase: evaluation.phase,
        objectiveIndex,
        checkpointIndex
      };
    }
    objectiveIndex += 1;
  }
  return {status: 'completed', objectiveIndex, checkpointIndex};
}

export function evaluateMissionObjective(
  objective: MissionObjectiveDefinition,
  context: MissionObjectiveContext,
  checkpointIndex: number
): ObjectiveEvaluation {
  if (objective.kind === 'acquire-vehicle') {
    return {
      status: context.targetOccupiedByCrew ? 'completed' : 'active',
      phase: objective.phase,
      checkpointIndex
    };
  }
  if (objective.kind === 'clear-wanted') {
    return {
      status: context.teamWantedLevel === 0 ? 'completed' : 'active',
      phase: objective.phase,
      checkpointIndex
    };
  }
  if (objective.kind === 'vehicle-checkpoints') {
    const requiredCount = Math.min(
      context.checkpoints.length,
      Math.max(0, Math.floor(objective.checkpointCount ?? context.checkpoints.length))
    );
    if (checkpointIndex >= requiredCount) {
      return {status: 'completed', phase: objective.phase, checkpointIndex};
    }
    const checkpoint = context.checkpoints[checkpointIndex];
    const reached = context.targetOccupiedByCrew && Boolean(checkpoint) && Math.hypot(
      context.targetX - checkpoint.x,
      context.targetY - checkpoint.y
    ) <= checkpoint.radius;
    const nextCheckpointIndex = reached ? checkpointIndex + 1 : checkpointIndex;
    return {
      status: nextCheckpointIndex >= requiredCount ? 'completed' : 'active',
      phase: objective.phase,
      checkpointIndex: nextCheckpointIndex
    };
  }
  if (objective.wantedGate && context.teamWantedLevel > 0) {
    return {status: 'active', phase: 'lose-heat', checkpointIndex};
  }
  const reachedDelivery = context.targetOccupiedByCrew && Math.hypot(
    context.targetX - context.deliveryX,
    context.targetY - context.deliveryY
  ) <= context.deliveryRadius;
  const maximumSpeed = Math.max(0, objective.maximumSpeed ?? 32);
  return {
    status: reachedDelivery && Math.abs(context.targetSpeed) <= maximumSpeed
      ? 'completed'
      : 'active',
    phase: objective.phase,
    checkpointIndex
  };
}

function boundedIndex(value: number, maximum: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(maximum, Math.floor(value)));
}
