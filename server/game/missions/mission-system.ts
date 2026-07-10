export type MissionPhase =
  | 'forming'
  | 'steal'
  | 'lose-heat'
  | 'deliver'
  | 'completed'
  | 'failed';
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

export interface VehicleTheftMission {
  id: string;
  templateId: 'boost-and-deliver';
  leaderId: string;
  participants: MissionParticipant[];
  rosterVersion: number;
  rosterLockedAt: number;
  maximumParticipants: number;
  targetVehicleId: string;
  phase: MissionPhase;
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

export interface StartVehicleTheftInput {
  leaderId: string;
  targetVehicleId: string;
  deliveryX: number;
  deliveryY: number;
  nowMs: number;
  formationDurationMs?: number;
  durationMs?: number;
  baseReward?: number;
  maximumParticipants?: number;
}

export type StartMissionResult =
  | {ok: true; mission: VehicleTheftMission}
  | {ok: false; reason: 'participant-active' | 'target-reserved' | 'invalid'};

export type JoinMissionResult =
  | {ok: true; mission: VehicleTheftMission}
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
}

export interface MissionWorldSnapshot {
  nowMs: number;
  participants: MissionParticipantSnapshot[];
  targetExists: boolean;
  targetDestroyed: boolean;
  targetHealth: number;
  targetMaxHealth: number;
  targetX: number;
  targetY: number;
  targetSpeed: number;
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
  private readonly missions = new Map<string, VehicleTheftMission>();
  private readonly participantMissions = new Map<string, string>();
  private readonly reservedTargets = new Map<string, string>();
  private nextMissionId = 1;

  startVehicleTheft(input: StartVehicleTheftInput): StartMissionResult {
    if (
      !input.leaderId ||
      !input.targetVehicleId ||
      !Number.isFinite(input.nowMs) ||
      !Number.isFinite(input.deliveryX) ||
      !Number.isFinite(input.deliveryY)
    ) {
      return {ok: false, reason: 'invalid'};
    }
    if (this.participantMissions.has(input.leaderId)) {
      return {ok: false, reason: 'participant-active'};
    }
    if (this.reservedTargets.has(input.targetVehicleId)) {
      return {ok: false, reason: 'target-reserved'};
    }
    const id = `mission-${this.nextMissionId++}`;
    const baseReward = Math.max(0, Math.floor(input.baseReward ?? 500));
    const durationMs = Math.max(10_000, input.durationMs ?? 180_000);
    const formationDurationMs = Math.max(3_000, Math.min(60_000, input.formationDurationMs ?? 15_000));
    const maximumParticipants = Math.max(1, Math.min(4, Math.floor(input.maximumParticipants ?? 4)));
    const mission: VehicleTheftMission = {
      id,
      templateId: 'boost-and-deliver',
      leaderId: input.leaderId,
      participants: [createParticipant(input.leaderId, 'leader', input.nowMs)],
      rosterVersion: 1,
      rosterLockedAt: 0,
      maximumParticipants,
      targetVehicleId: input.targetVehicleId,
      phase: 'forming',
      formedAt: input.nowMs,
      formationEndsAt: input.nowMs + formationDurationMs,
      launchedAt: 0,
      expiresAt: 0,
      terminalAt: 0,
      lastUpdatedAt: input.nowMs,
      durationMs,
      deliveryX: input.deliveryX,
      deliveryY: input.deliveryY,
      deliveryRadius: 72,
      baseReward,
      projectedReward: baseReward,
      finalReward: 0,
      payouts: [],
      failureReason: ''
    };
    this.missions.set(id, mission);
    this.participantMissions.set(input.leaderId, id);
    this.reservedTargets.set(input.targetVehicleId, id);
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
    if (!world.targetExists || world.targetDestroyed) {
      transitions.push(this.fail(mission, 'target-destroyed', world.nowMs));
      return transitions;
    }
    if (world.nowMs >= mission.expiresAt) {
      transitions.push(this.fail(mission, 'time-expired', world.nowMs));
      return transitions;
    }

    const condition = vehicleCondition(world.targetHealth, world.targetMaxHealth);
    mission.projectedReward = conditionReward(mission.baseReward, condition);
    const participantSnapshots = new Map(world.participants.map((entry) => [entry.playerId, entry]));
    const targetOccupiedByCrew = mission.participants.some((participant) => (
      participant.connected &&
      participantSnapshots.get(participant.playerId)?.vehicleId === mission.targetVehicleId
    ));
    const teamWantedLevel = mission.participants.reduce((maximum, participant) => {
      if (!participant.connected) return maximum;
      return Math.max(maximum, participantSnapshots.get(participant.playerId)?.wantedLevel ?? 0);
    }, 0);
    if (mission.phase === 'steal' && targetOccupiedByCrew) {
      transitions.push(this.changePhase(mission, teamWantedLevel > 0 ? 'lose-heat' : 'deliver'));
    }
    if (mission.phase === 'lose-heat' && teamWantedLevel === 0) {
      transitions.push(this.changePhase(mission, 'deliver'));
    }
    if (mission.phase === 'deliver' && teamWantedLevel > 0) {
      transitions.push(this.changePhase(mission, 'lose-heat'));
    }
    const atDelivery = Math.hypot(
      world.targetX - mission.deliveryX,
      world.targetY - mission.deliveryY
    ) <= mission.deliveryRadius;
    if (
      mission.phase === 'deliver' &&
      targetOccupiedByCrew &&
      atDelivery &&
      Math.abs(world.targetSpeed) <= 32
    ) {
      mission.phase = 'completed';
      mission.terminalAt = world.nowMs;
      mission.finalReward = mission.projectedReward;
      mission.payouts = mission.participants
        .filter((participant) => participant.payoutEligible)
        .map((participant) => ({
          playerId: participant.playerId,
          amount: mission.finalReward,
          idempotencyKey: `${mission.id}:payout:${participant.playerId}`
        }));
      transitions.push({
        type: 'completed',
        missionId: mission.id,
        leaderId: mission.leaderId,
        phase: 'completed',
        rewardPerParticipant: mission.finalReward,
        condition,
        payouts: mission.payouts.map((payout) => ({...payout}))
      });
    }
    return transitions;
  }

  abandon(missionId: string, actorId: string, nowMs: number): MissionTransition[] {
    const mission = this.missions.get(missionId);
    if (!mission || isTerminal(mission.phase) || mission.leaderId !== actorId) return [];
    return [this.fail(mission, 'abandoned', nowMs)];
  }

  get(missionId: string): VehicleTheftMission | undefined {
    const mission = this.missions.get(missionId);
    return mission ? cloneMission(mission) : undefined;
  }

  getByParticipant(playerId: string): VehicleTheftMission | undefined {
    const missionId = this.participantMissions.get(playerId);
    return missionId ? this.get(missionId) : undefined;
  }

  list(): VehicleTheftMission[] {
    return [...this.missions.values()]
      .map(cloneMission)
      .sort((left, right) => left.id.localeCompare(right.id));
  }

  remove(missionId: string): VehicleTheftMission | undefined {
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

  private observeParticipants(mission: VehicleTheftMission, world: MissionWorldSnapshot): void {
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
    mission: VehicleTheftMission,
    nowMs: number
  ): Extract<MissionTransition, {type: 'phase'}> {
    mission.rosterLockedAt = nowMs;
    mission.launchedAt = nowMs;
    mission.expiresAt = nowMs + mission.durationMs;
    return this.changePhase(mission, 'steal');
  }

  private changePhase(
    mission: VehicleTheftMission,
    phase: MissionPhase
  ): Extract<MissionTransition, {type: 'phase'}> {
    const previousPhase = mission.phase;
    mission.phase = phase;
    return {type: 'phase', missionId: mission.id, leaderId: mission.leaderId, previousPhase, phase};
  }

  private transferLeadership(
    mission: VehicleTheftMission
  ): Extract<MissionTransition, {type: 'leader-transferred'}> {
    const previousLeaderId = mission.leaderId;
    const nextLeader = mission.participants
      .filter((participant) => participant.connected)
      .sort((left, right) => left.joinedAt - right.joinedAt || left.playerId.localeCompare(right.playerId))[0];
    for (const participant of mission.participants) participant.role = 'support';
    nextLeader.role = 'leader';
    mission.leaderId = nextLeader.playerId;
    return {type: 'leader-transferred', missionId: mission.id, previousLeaderId, leaderId: nextLeader.playerId};
  }

  private rosterTransition(mission: VehicleTheftMission): Extract<MissionTransition, {type: 'roster'}> {
    return {
      type: 'roster',
      missionId: mission.id,
      leaderId: mission.leaderId,
      rosterVersion: mission.rosterVersion,
      participantIds: mission.participants.map((participant) => participant.playerId)
    };
  }

  private fail(
    mission: VehicleTheftMission,
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

function cloneMission(mission: VehicleTheftMission): VehicleTheftMission {
  return {
    ...mission,
    participants: mission.participants.map((participant) => ({...participant})),
    payouts: mission.payouts.map((payout) => ({...payout}))
  };
}

function isTerminal(phase: MissionPhase): boolean {
  return phase === 'completed' || phase === 'failed';
}

function vehicleCondition(health: number, maxHealth: number): number {
  if (maxHealth <= 0) return 0;
  return Math.max(0, Math.min(1, health / maxHealth));
}

function conditionReward(baseReward: number, condition: number): number {
  return Math.floor(baseReward * (0.35 + condition * 0.65));
}
