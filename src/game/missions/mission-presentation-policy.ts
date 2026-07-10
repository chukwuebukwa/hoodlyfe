import type {MinimapPointInput} from '../minimap-marker-policy.ts';
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
}

export interface MissionWorldProjection {
  contact: {x: number; y: number};
  target?: {x: number; y: number; angle: number};
  delivery?: {x: number; y: number; radius: number};
}

export function projectMissionHud(
  state: DistrictNetworkState,
  localPlayerId: string
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
  const base = {
    visible: true,
    title: mission ? 'BOOST AND DELIVER' : 'STREET CONTACT',
    timer: mission ? formatMissionTime(mission.remainingMs) : 'AVAILABLE',
    objective: mission
      ? missionObjective(mission, Boolean(active), localPlayerId)
      : 'Boost a marked traffic vehicle and deliver it intact.',
    meta: mission
      ? `CREW ${mission.participants.size}/${mission.maximumParticipants} | $${mission.projectedReward}`
      : 'FREEMODE CREW WORK',
    missionId: mission?.id ?? ''
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
  const target = state.vehicles?.get(mission.targetVehicleId);
  if (target) projection.target = vehiclePoint(target);
  return projection;
}

export function missionMinimapPoints(
  state: DistrictNetworkState,
  localPlayerId: string
): MinimapPointInput[] {
  const points: MinimapPointInput[] = [{
    id: 'boost-contact',
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
  if (mission.phase === 'lose-heat') return 'Lose all crew police heat.';
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
    missionId: ''
  };
}
