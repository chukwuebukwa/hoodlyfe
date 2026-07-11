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

export interface MissionObjectiveParticipant {
  playerId: string;
  connected: boolean;
  alive: boolean;
  vehicleId: string;
  x: number;
  y: number;
}

export interface MissionObjectiveContext {
  participants: readonly MissionObjectiveParticipant[];
  targetOccupiedByCrew: boolean;
  teamWantedLevel: number;
  targetX: number;
  targetY: number;
  targetSpeed: number;
  deliveryX: number;
  deliveryY: number;
  deliveryRadius: number;
  checkpoints: readonly MissionCheckpoint[];
  elapsedMs: number;
  holdX: number;
  holdY: number;
  holdRadius: number;
  holdContested: boolean;
  encounterComplete: boolean;
}

export interface MissionObjectiveProgress {
  objectiveIndex: number;
  checkpointIndex: number;
  holdProgressMs?: number;
}

export type MissionObjectiveAdvance =
  | {
      status: 'active';
      objective: MissionObjectiveDefinition;
      phase: ActiveMissionPhase;
      objectiveIndex: number;
      checkpointIndex: number;
      holdProgressMs: number;
    }
  | {
      status: 'completed';
      objectiveIndex: number;
      checkpointIndex: number;
      holdProgressMs: number;
    };

interface ObjectiveEvaluation {
  status: 'active' | 'completed';
  phase: ActiveMissionPhase;
  checkpointIndex: number;
  holdProgressMs?: number;
}

export function advanceMissionObjectives(
  template: MissionTemplateDefinition,
  progress: MissionObjectiveProgress,
  context: MissionObjectiveContext
): MissionObjectiveAdvance {
  let objectiveIndex = boundedIndex(progress.objectiveIndex, template.objectives.length);
  let checkpointIndex = boundedIndex(progress.checkpointIndex, context.checkpoints.length);
  let holdProgressMs = boundedDuration(progress.holdProgressMs ?? 0);
  while (objectiveIndex < template.objectives.length) {
    const objective = template.objectives[objectiveIndex];
    const evaluation = evaluateMissionObjective(
      objective,
      context,
      checkpointIndex,
      holdProgressMs
    );
    checkpointIndex = evaluation.checkpointIndex;
    holdProgressMs = evaluation.holdProgressMs ?? holdProgressMs;
    if (evaluation.status === 'active') {
      return {
        status: 'active',
        objective,
        phase: evaluation.phase,
        objectiveIndex,
        checkpointIndex,
        holdProgressMs
      };
    }
    objectiveIndex += 1;
  }
  return {status: 'completed', objectiveIndex, checkpointIndex, holdProgressMs};
}

export function evaluateMissionObjective(
  objective: MissionObjectiveDefinition,
  context: MissionObjectiveContext,
  checkpointIndex: number,
  holdProgressMs = 0
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
  if (objective.kind === 'crew-checkpoints') {
    const requiredCount = Math.min(
      context.checkpoints.length,
      Math.max(0, Math.floor(objective.checkpointCount ?? context.checkpoints.length))
    );
    if (checkpointIndex >= requiredCount) {
      return {status: 'completed', phase: objective.phase, checkpointIndex};
    }
    const checkpoint = context.checkpoints[checkpointIndex];
    const reached = Boolean(checkpoint) && context.participants.some((participant) => (
      participant.connected &&
      participant.alive &&
      Boolean(participant.vehicleId) &&
      Math.hypot(participant.x - checkpoint.x, participant.y - checkpoint.y) <= checkpoint.radius
    ));
    const nextCheckpointIndex = reached ? checkpointIndex + 1 : checkpointIndex;
    return {
      status: nextCheckpointIndex >= requiredCount ? 'completed' : 'active',
      phase: objective.phase,
      checkpointIndex: nextCheckpointIndex
    };
  }
  if (objective.kind === 'hold-area') {
    const requiredMs = Math.max(1_000, Math.floor(objective.durationMs ?? 1_000));
    const crewPresent = context.participants.some((participant) => (
      participant.connected &&
      participant.alive &&
      Math.hypot(participant.x - context.holdX, participant.y - context.holdY) <=
        context.holdRadius
    ));
    const elapsedMs = Math.max(0, Math.min(1_000, context.elapsedMs));
    const nextHoldProgressMs = crewPresent && !context.holdContested
      ? Math.min(requiredMs, boundedDuration(holdProgressMs) + elapsedMs)
      : boundedDuration(holdProgressMs);
    return {
      status: nextHoldProgressMs >= requiredMs && context.encounterComplete
        ? 'completed'
        : 'active',
      phase: objective.phase,
      checkpointIndex,
      holdProgressMs: nextHoldProgressMs
    };
  }
  if (objective.kind === 'eliminate-target') {
    return {
      status: context.encounterComplete ? 'completed' : 'active',
      phase: objective.phase,
      checkpointIndex
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

function boundedDuration(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}
