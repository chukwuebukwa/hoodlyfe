import type {MinimapPointInput} from '../minimap-marker-policy.ts';
import {
  DEFAULT_MISSION_TEMPLATE_ID,
  missionTemplate,
  type MissionTemplateId
} from '../../../shared/content/mission-catalog.ts';
import type {
  DistrictNetworkState,
  NetworkMission,
  NetworkPlayer,
  NetworkVehicle
} from '../types.ts';

export type MissionAction = '' | 'start' | 'join' | 'launch' | 'abandon';

export interface MissionHudProjection {
  visible: boolean;
  title: string;
  timer: string;
  objective: string;
  meta: string;
  action: MissionAction;
  actionLabel: string;
  actionWarning: boolean;
  missionId: string;
  templateId: MissionTemplateId;
  templateSelectorVisible: boolean;
}

export interface MissionWorldProjection {
  contact: {x: number; y: number};
  target?: {x: number; y: number; angle: number};
  checkpoint?: {x: number; y: number; radius: number};
  hold?: {x: number; y: number; radius: number; contested: boolean};
  delivery?: {x: number; y: number; radius: number};
}

export function projectMissionHud(
  state: DistrictNetworkState,
  localPlayerId: string,
  offeredTemplateId: MissionTemplateId = DEFAULT_MISSION_TEMPLATE_ID
): MissionHudProjection {
  const local = state.players?.get(localPlayerId);
  if (!local) return hiddenHud();
  const active = selectLocalMission(state, localPlayerId);
  const joinable = active ? undefined : selectJoinableMission(state, local);
  const nearContact = Math.hypot(
    local.x - state.missionContactX,
    local.y - state.missionContactY
  ) <= 130;
  if (!active && !joinable && !nearContact) return hiddenHud();
  const mission = active ?? joinable;
  const templateId = mission?.templateId ?? offeredTemplateId;
  const definition = missionTemplate(templateId);
  const base = {
    visible: true,
    title: definition.label,
    timer: mission ? formatMissionTime(mission.remainingMs) : 'AVAILABLE',
    objective: mission
      ? missionObjective(mission, Boolean(active), localPlayerId)
      : definition.summary,
    meta: mission
      ? missionMeta(mission)
      : `FREEMODE | $${definition.baseReward}`,
    missionId: mission?.id ?? '',
    templateId,
    templateSelectorVisible: !mission
  };
  if (!mission) {
    return {...base, action: 'start', actionLabel: 'START JOB', actionWarning: false};
  }
  if (!active) {
    return {...base, action: 'join', actionLabel: 'JOIN CREW', actionWarning: false};
  }
  if (mission.phase === 'forming' && mission.leaderId === localPlayerId) {
    return {...base, action: 'launch', actionLabel: 'LAUNCH', actionWarning: false};
  }
  if (
    mission.leaderId === localPlayerId &&
    mission.phase !== 'completed' &&
    mission.phase !== 'failed'
  ) {
    return {...base, action: 'abandon', actionLabel: 'ABANDON', actionWarning: true};
  }
  return {...base, action: '', actionLabel: '', actionWarning: false};
}

export function projectMissionWorld(
  state: DistrictNetworkState,
  localPlayerId: string
): MissionWorldProjection {
  const projection: MissionWorldProjection = {
    contact: {x: state.missionContactX, y: state.missionContactY}
  };
  const mission = activeWorldMission(state, localPlayerId);
  if (!mission) return projection;
  if (mission.phase === 'deliver') {
    projection.delivery = {
      x: mission.deliveryX,
      y: mission.deliveryY,
      radius: mission.deliveryRadius
    };
  }
  if (mission.phase === 'checkpoints' && mission.checkpointRadius > 0) {
    projection.checkpoint = {
      x: mission.checkpointX,
      y: mission.checkpointY,
      radius: mission.checkpointRadius
    };
  }
  if (mission.phase === 'hold' && mission.holdRadius > 0) {
    projection.hold = {
      x: mission.holdX,
      y: mission.holdY,
      radius: mission.holdRadius,
      contested: mission.holdContested
    };
  }
  if (mission.phase === 'eliminate') {
    const targetNpc = mission.targetNpcId ? state.npcs?.get(mission.targetNpcId) : undefined;
    projection.target = targetNpc
      ? {x: targetNpc.x, y: targetNpc.y, angle: targetNpc.angle}
      : {x: mission.holdX, y: mission.holdY, angle: 0};
  }
  const target = state.vehicles?.get(mission.targetVehicleId);
  if (target) projection.target = vehiclePoint(target);
  return projection;
}

export function missionMinimapPoints(
  state: DistrictNetworkState,
  localPlayerId: string
): MinimapPointInput[] {
  const points: MinimapPointInput[] = [{
    id: 'freemode-contact',
    kind: 'contact',
    x: state.missionContactX,
    y: state.missionContactY
  }];
  const mission = activeWorldMission(state, localPlayerId);
  if (!mission) return points;
  if (mission.phase === 'deliver') {
    points.push({
      id: `${mission.id}:delivery`,
      kind: 'objective',
      x: mission.deliveryX,
      y: mission.deliveryY
    });
    return points;
  }
  if (mission.phase === 'checkpoints' && mission.checkpointRadius > 0) {
    points.push({
      id: `${mission.id}:checkpoint:${mission.checkpointIndex}`,
      kind: 'objective',
      x: mission.checkpointX,
      y: mission.checkpointY
    });
  }
  if (mission.phase === 'hold' && mission.holdRadius > 0) {
    points.push({
      id: `${mission.id}:hold`,
      kind: 'objective',
      x: mission.holdX,
      y: mission.holdY
    });
    for (const npc of state.npcs.values()) {
      if (!npc.alive || npc.kind !== 'hostile') continue;
      points.push({
        id: `${mission.id}:hostile:${npc.id}`,
        kind: 'hostile',
        x: npc.x,
        y: npc.y,
        angle: npc.angle
      });
    }
  }
  if (mission.phase === 'eliminate') {
    for (const npc of state.npcs.values()) {
      if (!npc.alive || npc.kind !== 'hostile') continue;
      points.push({
        id: `${mission.id}:hostile:${npc.id}`,
        kind: npc.id === mission.targetNpcId ? 'objective' : 'hostile',
        x: npc.x,
        y: npc.y,
        angle: npc.angle
      });
    }
    if (!mission.targetNpcId) {
      points.push({
        id: `${mission.id}:hideout`,
        kind: 'objective',
        x: mission.holdX,
        y: mission.holdY
      });
    }
  }
  const target = state.vehicles?.get(mission.targetVehicleId);
  if (target) {
    points.push({
      id: `${mission.id}:target`,
      kind: 'objective',
      ...vehiclePoint(target)
    });
  }
  return points;
}

export function selectLocalMission(
  state: DistrictNetworkState,
  localPlayerId: string
): NetworkMission | undefined {
  return [...(state.missions?.values() ?? [])]
    .sort((left, right) => left.id.localeCompare(right.id))
    .find((mission) => mission.participants?.has(localPlayerId));
}

export function selectJoinableMission(
  state: DistrictNetworkState,
  local: NetworkPlayer
): NetworkMission | undefined {
  return [...(state.missions?.values() ?? [])]
    .filter((mission) => (
      mission.phase === 'forming' &&
      mission.participants.size < mission.maximumParticipants
    ))
    .sort((left, right) => left.id.localeCompare(right.id))
    .find((mission) => {
      const leader = state.players?.get(mission.leaderId);
      return Boolean(leader && Math.hypot(local.x - leader.x, local.y - leader.y) <= 260);
    });
}

function activeWorldMission(
  state: DistrictNetworkState,
  localPlayerId: string
): NetworkMission | undefined {
  const mission = selectLocalMission(state, localPlayerId);
  if (!mission || ['forming', 'completed', 'failed'].includes(mission.phase)) return undefined;
  return mission;
}

function missionObjective(
  mission: NetworkMission,
  isParticipant: boolean,
  localPlayerId: string
): string {
  if (mission.phase === 'forming') {
    if (!isParticipant) {
      const leader = mission.participants.get(mission.leaderId)?.name ?? 'A nearby driver';
      return `${leader} is forming a crew.`;
    }
    return mission.leaderId === localPlayerId
      ? 'Crew forming. Launch now or wait for nearby drivers.'
      : 'Crew ready. Waiting for the leader to launch.';
  }
  if (mission.phase === 'steal') return 'Steal the marked traffic vehicle.';
  if (mission.phase === 'checkpoints') {
    const prefix = mission.objectiveKind === 'crew-checkpoints'
      ? 'Get any crew vehicle through checkpoint'
      : 'Drive the target through checkpoint';
    return `${prefix} ${Math.min(
      mission.checkpointIndex + 1,
      mission.checkpointCount
    )} of ${mission.checkpointCount}.`;
  }
  if (mission.phase === 'lose-heat') return 'Lose all crew police heat.';
  if (mission.phase === 'hold') {
    const remainingSeconds = Math.max(
      0,
      Math.ceil((mission.holdRequiredMs - mission.holdProgressMs) / 1000)
    );
    if (mission.holdContested) return 'Zone contested. Clear attackers inside the boundary.';
    if (mission.encounterComplete && remainingSeconds > 0) {
      return `Waves cleared. Hold the zone for ${remainingSeconds}s.`;
    }
    return `Defend the zone for ${remainingSeconds}s and clear the hostile waves.`;
  }
  if (mission.phase === 'eliminate') {
    if (!mission.targetNpcId) {
      return `Clear the guards. ${mission.encounterRemaining} hostile${mission.encounterRemaining === 1 ? '' : 's'} left.`;
    }
    return 'Eliminate the marked crime boss.';
  }
  if (mission.phase === 'deliver') {
    return 'Bring the target into the green delivery zone at low speed.';
  }
  if (mission.phase === 'completed') {
    return `Job complete. Crew paid $${mission.finalReward} each.`;
  }
  if (mission.failureReason === 'target-destroyed') return 'Job failed. The target was destroyed.';
  if (mission.failureReason === 'time-expired') return 'Job failed. Time expired.';
  if (mission.failureReason === 'all-participants-disconnected') {
    return 'Job failed. The crew disconnected.';
  }
  return 'Job abandoned.';
}

function formatMissionTime(remainingMs: number): string {
  const seconds = Math.max(0, Math.ceil(remainingMs / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function missionMeta(mission: NetworkMission): string {
  if (mission.phase === 'hold' || mission.phase === 'eliminate') {
    return `W${Math.max(1, mission.encounterWave)}/${mission.encounterWaveCount} | ` +
      `${mission.encounterRemaining} LEFT | $${mission.projectedReward}`;
  }
  return `CREW ${mission.participants.size}/${mission.maximumParticipants} | ` +
    `$${mission.projectedReward}`;
}

function vehiclePoint(vehicle: NetworkVehicle): {x: number; y: number; angle: number} {
  return {x: vehicle.x, y: vehicle.y, angle: vehicle.angle};
}

function hiddenHud(): MissionHudProjection {
  return {
    visible: false,
    title: '',
    timer: '',
    objective: '',
    meta: '',
    action: '',
    actionLabel: '',
    actionWarning: false,
    missionId: '',
    templateId: DEFAULT_MISSION_TEMPLATE_ID,
    templateSelectorVisible: false
  };
}
