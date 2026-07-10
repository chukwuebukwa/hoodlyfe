import {
  DEFAULT_MISSION_TEMPLATE_ID,
  isMissionTemplateId,
  missionCheckpointCount,
  missionTemplate,
  type ActiveMissionPhase,
  type MissionObjectiveKind,
  type MissionTemplateId
} from '../../../shared/content/mission-catalog.ts';
import {
  advanceMissionObjectives,
  type MissionCheckpoint
} from './mission-objective-system.ts';
import {conditionReward, vehicleCondition} from './mission-reward-policy.ts';

export type MissionPhase = 'forming' | ActiveMissionPhase | 'completed' | 'failed';
export type MissionFailureReason =
  | 'all-participants-disconnected'
  | 'target-destroyed'
  | 'time-expired'
  | 'abandoned';
export type MissionParticipantRole = 'leader' | 'support';

export interface MissionParticipant {
  playerId: string;
  role: MissionParticipantRole;
  joinedAt: number;
  connected: boolean;
  alive: boolean;
  deaths: number;
  activeMs: number;
  payoutEligible: boolean;
}

export interface MissionPayout {
  playerId: string;
  amount: number;
  idempotencyKey: string;
}

export interface FreemodeMission {
  id: string;
  templateId: MissionTemplateId;
  leaderId: string;
  participants: MissionParticipant[];
  rosterVersion: number;
  rosterLockedAt: number;
  maximumParticipants: number;
  targetVehicleId: string;
  phase: MissionPhase;
  objectiveId: string;
  objectiveKind: MissionObjectiveKind;
  objectiveIndex: number;
  objectiveCount: number;
  checkpoints: MissionCheckpoint[];
  checkpointIndex: number;
  formedAt: number;
  formationEndsAt: number;
  launchedAt: number;
  expiresAt: number;
  terminalAt: number;
  lastUpdatedAt: number;
  durationMs: number;
  deliveryX: number;
  deliveryY: number;
  deliveryRadius: number;
  baseReward: number;
  projectedReward: number;
  finalReward: number;
  payouts: MissionPayout[];
  failureReason: MissionFailureReason | '';
}

export interface StartMissionInput {
  leaderId: string;
  templateId?: MissionTemplateId;
  targetVehicleId?: string;
  deliveryX?: number;
  deliveryY?: number;
  checkpoints?: readonly MissionCheckpoint[];
  nowMs: number;
  formationDurationMs?: number;
  durationMs?: number;
  baseReward?: number;
  maximumParticipants?: number;
}

export type StartMissionResult =
  | {ok: true; mission: FreemodeMission}
  | {ok: false; reason: 'participant-active' | 'target-reserved' | 'invalid'};

export type JoinMissionResult =
  | {ok: true; mission: FreemodeMission}
  | {
      ok: false;
      reason: 'not-found' | 'roster-locked' | 'roster-full' | 'participant-active' | 'invalid';
    };

export type LaunchMissionResult =
  | {ok: true; transition: Extract<MissionTransition, {type: 'phase'}>}
  | {ok: false; reason: 'not-found' | 'not-leader' | 'already-launched'};

export interface MissionParticipantSnapshot {
  playerId: string;
  exists: boolean;
  alive: boolean;
  vehicleId: string;
  wantedLevel: number;
  x: number;
  y: number;
}

export interface MissionWorldSnapshot {
  nowMs: number;
  participants: MissionParticipantSnapshot[];
  targetExists?: boolean;
  targetDestroyed?: boolean;
  targetHealth?: number;
  targetMaxHealth?: number;
  targetX?: number;
  targetY?: number;
  targetSpeed?: number;
}

export type MissionTransition =
  | {
      type: 'roster';
      missionId: string;
      leaderId: string;
      rosterVersion: number;
      participantIds: string[];
    }
  | {
      type: 'leader-transferred';
      missionId: string;
      previousLeaderId: string;
      leaderId: string;
    }
  | {
      type: 'phase';
      missionId: string;
      leaderId: string;
      previousPhase: MissionPhase;
      phase: MissionPhase;
    }
  | {
      type: 'completed';
      missionId: string;
      leaderId: string;
      phase: 'completed';
      rewardPerParticipant: number;
      condition: number;
      payouts: MissionPayout[];
    }
  | {
      type: 'failed';
      missionId: string;
      leaderId: string;
      phase: 'failed';
      reason: MissionFailureReason;
    };

export class MissionSystem {
  private readonly missions = new Map<string, FreemodeMission>();
  private readonly participantMissions = new Map<string, string>();
  private readonly reservedTargets = new Map<string, string>();
  private nextMissionId = 1;

  start(input: StartMissionInput): StartMissionResult {
    const templateId = input.templateId ?? DEFAULT_MISSION_TEMPLATE_ID;
    if (
      !input.leaderId ||
      !isMissionTemplateId(templateId) ||
      !Number.isFinite(input.nowMs)
    ) {
      return {ok: false, reason: 'invalid'};
    }
    const definition = missionTemplate(templateId);
    const targetVehicleId = String(input.targetVehicleId ?? '');
    const deliveryX = input.deliveryX ?? 0;
    const deliveryY = input.deliveryY ?? 0;
    if (
      !Number.isFinite(deliveryX) ||
      !Number.isFinite(deliveryY) ||
      (definition.targetMode === 'reserved-traffic-vehicle' && !targetVehicleId)
    ) {
      return {ok: false, reason: 'invalid'};
    }
    const checkpoints = validateCheckpoints(input.checkpoints ?? [], missionCheckpointCount(templateId));
    if (!checkpoints) return {ok: false, reason: 'invalid'};
    if (this.participantMissions.has(input.leaderId)) {
      return {ok: false, reason: 'participant-active'};
    }
    if (targetVehicleId && this.reservedTargets.has(targetVehicleId)) {
      return {ok: false, reason: 'target-reserved'};
    }
    const id = `mission-${this.nextMissionId++}`;
    const baseReward = Math.max(0, Math.floor(input.baseReward ?? definition.baseReward));
    const durationMs = Math.max(10_000, input.durationMs ?? definition.durationMs);
    const formationDurationMs = Math.max(
      3_000,
      Math.min(60_000, input.formationDurationMs ?? definition.formationDurationMs)
    );
    const maximumParticipants = Math.max(
      1,
      Math.min(4, Math.floor(input.maximumParticipants ?? definition.maximumParticipants))
    );
    const firstObjective = definition.objectives[0];
    if (!firstObjective) return {ok: false, reason: 'invalid'};
    const mission: FreemodeMission = {
      id,
      templateId,
      leaderId: input.leaderId,
      participants: [createParticipant(input.leaderId, 'leader', input.nowMs)],
      rosterVersion: 1,
      rosterLockedAt: 0,
      maximumParticipants,
      targetVehicleId,
      phase: 'forming',
      objectiveId: firstObjective.id,
      objectiveKind: firstObjective.kind,
      objectiveIndex: 0,
      objectiveCount: definition.objectives.length,
      checkpoints,
      checkpointIndex: 0,
      formedAt: input.nowMs,
      formationEndsAt: input.nowMs + formationDurationMs,
      launchedAt: 0,
      expiresAt: 0,
      terminalAt: 0,
      lastUpdatedAt: input.nowMs,
      durationMs,
      deliveryX,
      deliveryY,
      deliveryRadius: 72,
      baseReward,
      projectedReward: baseReward,
      finalReward: 0,
      payouts: [],
      failureReason: ''
    };
    this.missions.set(id, mission);
    this.participantMissions.set(input.leaderId, id);
    if (targetVehicleId) this.reservedTargets.set(targetVehicleId, id);
    return {ok: true, mission: cloneMission(mission)};
  }

  join(missionId: string, playerId: string, nowMs: number): JoinMissionResult {
    if (!missionId || !playerId || !Number.isFinite(nowMs)) return {ok: false, reason: 'invalid'};
    const mission = this.missions.get(missionId);
    if (!mission) return {ok: false, reason: 'not-found'};
    if (mission.phase !== 'forming' || nowMs >= mission.formationEndsAt) {
      return {ok: false, reason: 'roster-locked'};
    }
    if (mission.participants.length >= mission.maximumParticipants) {
      return {ok: false, reason: 'roster-full'};
    }
    if (this.participantMissions.has(playerId)) return {ok: false, reason: 'participant-active'};
    mission.participants.push(createParticipant(playerId, 'support', nowMs));
    mission.rosterVersion += 1;
    this.participantMissions.set(playerId, mission.id);
    return {ok: true, mission: cloneMission(mission)};
  }

  leaveFormation(missionId: string, playerId: string): MissionTransition[] {
    const mission = this.missions.get(missionId);
    if (!mission || mission.phase !== 'forming') return [];
    const participantIndex = mission.participants.findIndex((entry) => entry.playerId === playerId);
    if (participantIndex < 0) return [];
    const wasLeader = mission.leaderId === playerId;
    mission.participants.splice(participantIndex, 1);
    this.participantMissions.delete(playerId);
    mission.rosterVersion += 1;
    if (mission.participants.length === 0) {
      return [this.fail(mission, 'all-participants-disconnected', mission.lastUpdatedAt)];
    }
    const transitions: MissionTransition[] = [];
    if (wasLeader) transitions.push(this.transferLeadership(mission));
    transitions.push(this.rosterTransition(mission));
    return transitions;
  }

  launch(missionId: string, actorId: string, nowMs: number): LaunchMissionResult {
    const mission = this.missions.get(missionId);
    if (!mission) return {ok: false, reason: 'not-found'};
    if (mission.phase !== 'forming') return {ok: false, reason: 'already-launched'};
    if (mission.leaderId !== actorId) return {ok: false, reason: 'not-leader'};
    return {ok: true, transition: this.lockRoster(mission, nowMs)};
  }

  update(missionId: string, world: MissionWorldSnapshot): MissionTransition[] {
    const mission = this.missions.get(missionId);
    if (!mission || isTerminal(mission.phase)) return [];
    const transitions: MissionTransition[] = [];
    this.observeParticipants(mission, world);
    if (!mission.participants.some((participant) => participant.connected)) {
      return [this.fail(mission, 'all-participants-disconnected', world.nowMs)];
    }
    const leader = mission.participants.find((participant) => participant.playerId === mission.leaderId);
    if (!leader?.connected) transitions.push(this.transferLeadership(mission));
    if (mission.phase === 'forming') {
      if (world.nowMs >= mission.formationEndsAt) transitions.push(this.lockRoster(mission, world.nowMs));
      else return transitions;
    }
    const definition = missionTemplate(mission.templateId);
    if (
      definition.targetMode === 'reserved-traffic-vehicle' &&
      (!world.targetExists || world.targetDestroyed)
    ) {
      transitions.push(this.fail(mission, 'target-destroyed', world.nowMs));
      return transitions;
    }
    if (world.nowMs >= mission.expiresAt) {
      transitions.push(this.fail(mission, 'time-expired', world.nowMs));
      return transitions;
    }

    const condition = definition.rewardPolicy === 'vehicle-condition'
      ? vehicleCondition(world.targetHealth ?? 0, world.targetMaxHealth ?? 1)
      : 1;
    mission.projectedReward = definition.rewardPolicy === 'vehicle-condition'
      ? conditionReward(mission.baseReward, condition)
      : mission.baseReward;
    const participantSnapshots = new Map(world.participants.map((entry) => [entry.playerId, entry]));
    const targetOccupiedByCrew = mission.participants.some((participant) => (
      participant.connected &&
      Boolean(mission.targetVehicleId) &&
      participantSnapshots.get(participant.playerId)?.vehicleId === mission.targetVehicleId
    ));
    const teamWantedLevel = mission.participants.reduce((maximum, participant) => {
      if (!participant.connected) return maximum;
      return Math.max(maximum, participantSnapshots.get(participant.playerId)?.wantedLevel ?? 0);
    }, 0);
    const previousPhase = mission.phase;
    const progress = advanceMissionObjectives(
      definition,
      {objectiveIndex: mission.objectiveIndex, checkpointIndex: mission.checkpointIndex},
      {
        participants: mission.participants.map((participant) => {
          const snapshot = participantSnapshots.get(participant.playerId);
          return {
            playerId: participant.playerId,
            connected: participant.connected,
            alive: participant.alive,
            vehicleId: snapshot?.vehicleId ?? '',
            x: snapshot?.x ?? 0,
            y: snapshot?.y ?? 0
          };
        }),
        targetOccupiedByCrew,
        teamWantedLevel,
        targetX: world.targetX ?? 0,
        targetY: world.targetY ?? 0,
        targetSpeed: world.targetSpeed ?? 0,
        deliveryX: mission.deliveryX,
        deliveryY: mission.deliveryY,
        deliveryRadius: mission.deliveryRadius,
        checkpoints: mission.checkpoints
      }
    );
    mission.objectiveIndex = progress.objectiveIndex;
    mission.checkpointIndex = progress.checkpointIndex;
    if (progress.status === 'completed') {
      transitions.push(this.complete(mission, condition, world.nowMs));
      return transitions;
    }
    mission.objectiveId = progress.objective.id;
    mission.objectiveKind = progress.objective.kind;
    mission.phase = progress.phase;
    if (mission.phase !== previousPhase) {
      transitions.push({
        type: 'phase',
        missionId: mission.id,
        leaderId: mission.leaderId,
        previousPhase,
        phase: mission.phase
      });
    }
    return transitions;
  }

  abandon(missionId: string, actorId: string, nowMs: number): MissionTransition[] {
    const mission = this.missions.get(missionId);
    if (!mission || isTerminal(mission.phase) || mission.leaderId !== actorId) return [];
    return [this.fail(mission, 'abandoned', nowMs)];
  }

  get(missionId: string): FreemodeMission | undefined {
    const mission = this.missions.get(missionId);
    return mission ? cloneMission(mission) : undefined;
  }

  getByParticipant(playerId: string): FreemodeMission | undefined {
    const missionId = this.participantMissions.get(playerId);
    return missionId ? this.get(missionId) : undefined;
  }

  list(): FreemodeMission[] {
    return [...this.missions.values()]
      .map(cloneMission)
      .sort((left, right) => left.id.localeCompare(right.id));
  }

  remove(missionId: string): FreemodeMission | undefined {
    const mission = this.missions.get(missionId);
    if (!mission) return undefined;
    this.missions.delete(missionId);
    for (const participant of mission.participants) {
      if (this.participantMissions.get(participant.playerId) === missionId) {
        this.participantMissions.delete(participant.playerId);
      }
    }
    if (this.reservedTargets.get(mission.targetVehicleId) === missionId) {
      this.reservedTargets.delete(mission.targetVehicleId);
    }
    return cloneMission(mission);
  }

  isTargetReserved(vehicleId: string): boolean {
    return this.reservedTargets.has(vehicleId);
  }

  clear(): void {
    this.missions.clear();
    this.participantMissions.clear();
    this.reservedTargets.clear();
    this.nextMissionId = 1;
  }

  private observeParticipants(mission: FreemodeMission, world: MissionWorldSnapshot): void {
    const snapshots = new Map(world.participants.map((entry) => [entry.playerId, entry]));
    const elapsedMs = Math.max(0, Math.min(1_000, world.nowMs - mission.lastUpdatedAt));
    for (const participant of mission.participants) {
      const snapshot = snapshots.get(participant.playerId);
      const wasAlive = participant.alive;
      participant.connected = snapshot?.exists ?? false;
      participant.alive = participant.connected && (snapshot?.alive ?? false);
      if (wasAlive && participant.connected && !participant.alive) participant.deaths += 1;
      if (participant.connected && participant.alive) participant.activeMs += elapsedMs;
    }
    mission.lastUpdatedAt = world.nowMs;
  }

  private lockRoster(
    mission: FreemodeMission,
    nowMs: number
  ): Extract<MissionTransition, {type: 'phase'}> {
    mission.rosterLockedAt = nowMs;
    mission.launchedAt = nowMs;
    mission.expiresAt = nowMs + mission.durationMs;
    return this.changePhase(mission, missionTemplate(mission.templateId).objectives[0].phase);
  }

  private changePhase(
    mission: FreemodeMission,
    phase: MissionPhase
  ): Extract<MissionTransition, {type: 'phase'}> {
    const previousPhase = mission.phase;
    mission.phase = phase;
    return {type: 'phase', missionId: mission.id, leaderId: mission.leaderId, previousPhase, phase};
  }

  private transferLeadership(
    mission: FreemodeMission
  ): Extract<MissionTransition, {type: 'leader-transferred'}> {
    const previousLeaderId = mission.leaderId;
    const nextLeader = mission.participants
      .filter((participant) => participant.connected)
      .sort((left, right) => (
        left.joinedAt - right.joinedAt || left.playerId.localeCompare(right.playerId)
      ))[0];
    for (const participant of mission.participants) participant.role = 'support';
    nextLeader.role = 'leader';
    mission.leaderId = nextLeader.playerId;
    return {
      type: 'leader-transferred',
      missionId: mission.id,
      previousLeaderId,
      leaderId: nextLeader.playerId
    };
  }

  private rosterTransition(
    mission: FreemodeMission
  ): Extract<MissionTransition, {type: 'roster'}> {
    return {
      type: 'roster',
      missionId: mission.id,
      leaderId: mission.leaderId,
      rosterVersion: mission.rosterVersion,
      participantIds: mission.participants.map((participant) => participant.playerId)
    };
  }

  private complete(
    mission: FreemodeMission,
    condition: number,
    nowMs: number
  ): Extract<MissionTransition, {type: 'completed'}> {
    mission.phase = 'completed';
    mission.terminalAt = nowMs;
    mission.finalReward = mission.projectedReward;
    mission.payouts = mission.participants
      .filter((participant) => participant.payoutEligible && participant.connected)
      .map((participant) => ({
        playerId: participant.playerId,
        amount: mission.finalReward,
        idempotencyKey: `${mission.id}:payout:${participant.playerId}`
      }));
    return {
      type: 'completed',
      missionId: mission.id,
      leaderId: mission.leaderId,
      phase: 'completed',
      rewardPerParticipant: mission.finalReward,
      condition,
      payouts: mission.payouts.map((payout) => ({...payout}))
    };
  }

  private fail(
    mission: FreemodeMission,
    reason: MissionFailureReason,
    nowMs: number
  ): Extract<MissionTransition, {type: 'failed'}> {
    mission.phase = 'failed';
    mission.failureReason = reason;
    mission.terminalAt = nowMs;
    return {type: 'failed', missionId: mission.id, leaderId: mission.leaderId, phase: 'failed', reason};
  }
}

function createParticipant(
  playerId: string,
  role: MissionParticipantRole,
  joinedAt: number
): MissionParticipant {
  return {
    playerId,
    role,
    joinedAt,
    connected: true,
    alive: true,
    deaths: 0,
    activeMs: 0,
    payoutEligible: true
  };
}

function cloneMission(mission: FreemodeMission): FreemodeMission {
  return {
    ...mission,
    participants: mission.participants.map((participant) => ({...participant})),
    checkpoints: mission.checkpoints.map((checkpoint) => ({...checkpoint})),
    payouts: mission.payouts.map((payout) => ({...payout}))
  };
}

function validateCheckpoints(
  checkpoints: readonly MissionCheckpoint[],
  expectedCount: number
): MissionCheckpoint[] | undefined {
  if (checkpoints.length < expectedCount) return undefined;
  const selected = checkpoints.slice(0, expectedCount);
  if (selected.some((checkpoint) => (
    !checkpoint.id ||
    !Number.isFinite(checkpoint.x) ||
    !Number.isFinite(checkpoint.y) ||
    !Number.isFinite(checkpoint.radius) ||
    checkpoint.radius <= 0
  ))) {
    return undefined;
  }
  return selected.map((checkpoint) => ({
    id: checkpoint.id,
    x: checkpoint.x,
    y: checkpoint.y,
    radius: Math.max(24, Math.min(180, checkpoint.radius))
  }));
}

function isTerminal(phase: MissionPhase): boolean {
  return phase === 'completed' || phase === 'failed';
}
