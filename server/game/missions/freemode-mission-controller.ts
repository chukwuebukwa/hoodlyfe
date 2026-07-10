import type {MissionNotice} from '../../../shared/protocol/missions.ts';
import type {GameEventStream} from '../events/game-events.ts';
import type {DistrictState, VehicleState} from '../../state.ts';
import type {CollisionMap} from '../../world-map.ts';
import {MissionEntityScope} from './mission-entity-scope.ts';
import {projectMissionState} from './mission-state-projector.ts';
import {
  MissionSystem,
  type MissionTransition,
  type VehicleTheftMission
} from './mission-system.ts';

const VEHICLE_RADIUS = 20;
const CONTACT_RADIUS = 130;
const JOIN_RADIUS = 260;
const TERMINAL_RETENTION_MS = 4500;

interface MissionClock {
  tick: number;
  nowMs: number;
}

interface FreemodeMissionControllerOptions {
  state: DistrictState;
  world: CollisionMap;
  events: GameEventStream;
  clock: () => MissionClock;
  notice: (playerId: string, message: string, tone: MissionNotice['tone']) => void;
  releaseDeliveredVehicle: (vehicle: VehicleState, nowMs: number) => void;
}

export class FreemodeMissionController {
  private readonly system = new MissionSystem();
  private readonly entities = new MissionEntityScope();
  private readonly cleanupAt = new Map<string, number>();
  private readonly processedPayouts = new Set<string>();

  constructor(private readonly options: FreemodeMissionControllerOptions) {}

  start(playerId: string): void {
    const {state} = this.options;
    const player = state.players.get(playerId);
    if (!player?.alive) return;
    if (Math.hypot(player.x - state.missionContactX, player.y - state.missionContactY) > CONTACT_RADIUS) {
      this.options.notice(playerId, 'Meet the orange contact to start work.', 'warning');
      return;
    }
    const target = [...state.vehicles.values()]
      .filter((vehicle) => (
        vehicle.traffic &&
        !vehicle.destroyed &&
        !vehicle.hijackBy &&
        !this.system.isTargetReserved(vehicle.id)
      ))
      .sort((left, right) => (
        Math.hypot(left.x - player.x, left.y - player.y) -
        Math.hypot(right.x - player.x, right.y - player.y) ||
        left.id.localeCompare(right.id)
      ))[0];
    if (!target) {
      this.options.notice(playerId, 'No suitable traffic vehicle is available.', 'warning');
      return;
    }
    const clock = this.options.clock();
    const delivery = this.deliveryPoint(target, clock.nowMs);
    const result = this.system.startVehicleTheft({
      leaderId: playerId,
      targetVehicleId: target.id,
      deliveryX: delivery.x,
      deliveryY: delivery.y,
      nowMs: clock.nowMs,
      baseReward: 750
    });
    if (!result.ok) {
      const message = result.reason === 'participant-active'
        ? 'You are already assigned to active work.'
        : 'That vehicle is already reserved.';
      this.options.notice(playerId, message, 'warning');
      return;
    }
    this.entities.track({
      missionId: result.mission.id,
      kind: 'vehicle',
      entityId: target.id,
      disposition: 'release'
    });
    projectMissionState(state.missions, result.mission, state.players, clock.nowMs);
    this.options.notice(playerId, 'Crew forming. Invite nearby drivers or launch now.', 'info');
  }

  join(playerId: string, missionId: unknown): void {
    const id = String(missionId ?? '');
    const {state} = this.options;
    const player = state.players.get(playerId);
    const mission = this.system.get(id);
    if (!player?.alive || !mission) return;
    const leader = state.players.get(mission.leaderId);
    const joinX = leader?.x ?? state.missionContactX;
    const joinY = leader?.y ?? state.missionContactY;
    if (Math.hypot(player.x - joinX, player.y - joinY) > JOIN_RADIUS) {
      this.options.notice(playerId, 'Move closer to the crew leader to join.', 'warning');
      return;
    }
    const result = this.system.join(id, playerId, this.options.clock().nowMs);
    if (!result.ok) {
      const messages = {
        'not-found': 'That job is no longer available.',
        'roster-locked': 'That crew has already launched.',
        'roster-full': 'That crew is full.',
        'participant-active': 'You are already assigned to active work.',
        invalid: 'Unable to join that job.'
      } as const;
      this.options.notice(playerId, messages[result.reason], 'warning');
      return;
    }
    projectMissionState(state.missions, result.mission, state.players, this.options.clock().nowMs);
    this.broadcast(result.mission, `${player.name} joined the crew.`, 'info');
  }

  launch(playerId: string, missionId: unknown): void {
    const id = String(missionId ?? '');
    const clock = this.options.clock();
    const result = this.system.launch(id, playerId, clock.nowMs);
    if (!result.ok) {
      this.options.notice(
        playerId,
        result.reason === 'not-leader' ? 'Only the crew leader can launch.' : 'That job cannot launch.',
        'warning'
      );
      return;
    }
    const mission = this.system.get(id);
    if (!mission) return;
    this.processTransitions(mission, [result.transition], clock);
    projectMissionState(this.options.state.missions, mission, this.options.state.players, clock.nowMs);
  }

  abandon(playerId: string, missionId: unknown): void {
    const id = String(missionId ?? '');
    const mission = this.system.get(id);
    if (!mission) return;
    const clock = this.options.clock();
    const transitions = this.system.abandon(id, playerId, clock.nowMs);
    this.processTransitions(mission, transitions, clock);
  }

  update(nowMs: number): void {
    const {state} = this.options;
    for (const mission of this.system.list()) {
      const target = state.vehicles.get(mission.targetVehicleId);
      const transitions = this.system.update(mission.id, {
        nowMs,
        participants: mission.participants.map((participant) => {
          const player = state.players.get(participant.playerId);
          return {
            playerId: participant.playerId,
            exists: Boolean(player),
            alive: player?.alive ?? false,
            vehicleId: player?.vehicleId ?? '',
            wantedLevel: player?.wanted ?? 0
          };
        }),
        targetExists: Boolean(target),
        targetDestroyed: target?.destroyed ?? true,
        targetHealth: target?.health ?? 0,
        targetMaxHealth: target?.maxHealth ?? 1,
        targetX: target?.x ?? 0,
        targetY: target?.y ?? 0,
        targetSpeed: target?.speed ?? 0
      });
      const updated = this.system.get(mission.id);
      if (!updated) continue;
      this.processTransitions(updated, transitions, {...this.options.clock(), nowMs});
      projectMissionState(state.missions, updated, state.players, nowMs);
    }
    for (const [missionId, cleanupAt] of this.cleanupAt) {
      if (nowMs >= cleanupAt) this.cleanup(missionId, nowMs);
    }
  }

  get(missionId: string): VehicleTheftMission | undefined {
    return this.system.get(missionId);
  }

  private deliveryPoint(target: VehicleState, nowMs: number): {x: number; y: number} {
    const {state, world} = this.options;
    let fallback = world.trafficSpawn(nowMs + 701, VEHICLE_RADIUS);
    for (let attempt = 0; attempt < 24; attempt++) {
      const candidate = world.trafficSpawn(nowMs + 701 + attempt * 43, VEHICLE_RADIUS);
      fallback = candidate;
      if (
        Math.hypot(candidate.x - target.x, candidate.y - target.y) >= 650 &&
        Math.hypot(candidate.x - state.missionContactX, candidate.y - state.missionContactY) >= 380
      ) {
        return candidate;
      }
    }
    return fallback;
  }

  private processTransitions(
    mission: VehicleTheftMission,
    transitions: readonly MissionTransition[],
    clock: MissionClock
  ): void {
    for (const transition of transitions) {
      if (transition.type === 'phase') {
        this.options.events.publish({
          type: 'mission.phase-changed',
          tick: clock.tick,
          nowMs: clock.nowMs,
          missionId: transition.missionId,
          leaderId: transition.leaderId,
          previousPhase: transition.previousPhase,
          phase: transition.phase
        });
        this.broadcast(mission, phaseNotice(transition.phase), 'info');
      } else if (transition.type === 'leader-transferred') {
        const leaderName = this.options.state.players.get(transition.leaderId)?.name ?? transition.leaderId;
        this.broadcast(mission, `${leaderName} is now crew leader.`, 'warning');
      } else if (transition.type === 'completed') {
        for (const payout of transition.payouts) {
          if (this.processedPayouts.has(payout.idempotencyKey)) continue;
          this.processedPayouts.add(payout.idempotencyKey);
          const player = this.options.state.players.get(payout.playerId);
          if (player) player.cash += payout.amount;
          this.options.events.publish({
            type: 'mission.payout',
            tick: clock.tick,
            nowMs: clock.nowMs,
            missionId: transition.missionId,
            playerId: payout.playerId,
            amount: payout.amount,
            idempotencyKey: payout.idempotencyKey
          });
          this.options.notice(payout.playerId, `Job complete +$${payout.amount}`, 'success');
        }
        this.cleanupAt.set(mission.id, clock.nowMs + TERMINAL_RETENTION_MS);
      } else if (transition.type === 'failed') {
        this.options.events.publish({
          type: 'mission.failed',
          tick: clock.tick,
          nowMs: clock.nowMs,
          missionId: transition.missionId,
          leaderId: transition.leaderId,
          reason: transition.reason
        });
        this.broadcast(mission, failureNotice(transition.reason), 'warning');
        this.cleanupAt.set(mission.id, clock.nowMs + TERMINAL_RETENTION_MS);
      }
    }
  }

  private cleanup(missionId: string, nowMs: number): void {
    const mission = this.system.get(missionId);
    if (!mission) return;
    for (const entity of this.entities.drain(missionId)) {
      if (entity.kind !== 'vehicle' || entity.disposition !== 'release') continue;
      const vehicle = this.options.state.vehicles.get(entity.entityId);
      if (mission.phase === 'completed' && vehicle) {
        this.options.releaseDeliveredVehicle(vehicle, nowMs);
      }
    }
    this.system.remove(missionId);
    this.options.state.missions.delete(missionId);
    this.cleanupAt.delete(missionId);
  }

  private broadcast(
    mission: VehicleTheftMission,
    message: string,
    tone: MissionNotice['tone']
  ): void {
    for (const participant of mission.participants) {
      this.options.notice(participant.playerId, message, tone);
    }
  }
}

function phaseNotice(phase: string): string {
  if (phase === 'steal') return 'Job launched. Steal the marked vehicle.';
  if (phase === 'lose-heat') return 'Lose the crew\'s police heat.';
  if (phase === 'deliver') return 'Deliver the vehicle to the marked garage.';
  return 'Objective updated.';
}

function failureNotice(reason: string): string {
  if (reason === 'target-destroyed') return 'Job failed: target destroyed.';
  if (reason === 'all-participants-disconnected') return 'Job failed: crew disconnected.';
  if (reason === 'time-expired') return 'Job failed: time expired.';
  if (reason === 'abandoned') return 'Job abandoned.';
  return 'Job failed.';
}
