import type {MapSchema} from '@colyseus/schema';
import {MissionParticipantState, MissionState, type PlayerState} from '../../state.ts';
import type {FreemodeMission} from './mission-system.ts';

export function projectMissionState(
  missions: MapSchema<MissionState>,
  mission: FreemodeMission,
  players: MapSchema<PlayerState>,
  nowMs: number
): MissionState {
  let state = missions.get(mission.id);
  if (!state) {
    state = new MissionState();
    state.id = mission.id;
    state.templateId = mission.templateId;
    missions.set(mission.id, state);
  }
  state.leaderId = mission.leaderId;
  state.phase = mission.phase;
  state.objectiveId = mission.objectiveId;
  state.objectiveKind = mission.objectiveKind;
  state.objectiveIndex = mission.objectiveIndex;
  state.objectiveCount = mission.objectiveCount;
  state.targetVehicleId = mission.targetVehicleId;
  state.checkpointIndex = mission.checkpointIndex;
  state.checkpointCount = mission.checkpoints.length;
  const checkpoint = mission.checkpoints[mission.checkpointIndex];
  state.checkpointX = checkpoint?.x ?? 0;
  state.checkpointY = checkpoint?.y ?? 0;
  state.checkpointRadius = checkpoint?.radius ?? 0;
  state.deliveryX = mission.deliveryX;
  state.deliveryY = mission.deliveryY;
  state.deliveryRadius = mission.deliveryRadius;
  state.maximumParticipants = mission.maximumParticipants;
  state.rosterLockedAt = mission.rosterLockedAt;
  state.remainingMs = remainingTime(mission, nowMs);
  state.projectedReward = mission.projectedReward;
  state.finalReward = mission.finalReward;
  state.failureReason = mission.failureReason;

  const present = new Set<string>();
  for (const participant of mission.participants) {
    present.add(participant.playerId);
    let participantState = state.participants.get(participant.playerId);
    if (!participantState) {
      participantState = new MissionParticipantState();
      participantState.playerId = participant.playerId;
      state.participants.set(participant.playerId, participantState);
    }
    participantState.name = players.get(participant.playerId)?.name ?? participant.playerId;
    participantState.role = participant.role;
    participantState.connected = participant.connected;
    participantState.alive = participant.alive;
    participantState.deaths = participant.deaths;
    participantState.activeMs = participant.activeMs;
  }
  state.participants.forEach((_participant, playerId) => {
    if (!present.has(playerId)) state?.participants.delete(playerId);
  });
  return state;
}

function remainingTime(mission: FreemodeMission, nowMs: number): number {
  if (mission.phase === 'forming') return Math.max(0, mission.formationEndsAt - nowMs);
  if (mission.phase === 'completed' || mission.phase === 'failed') return 0;
  return Math.max(0, mission.expiresAt - nowMs);
}
