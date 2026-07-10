import type {GameNotice} from '../../../shared/protocol/notices.ts';
import {
  DEFAULT_MISSION_TEMPLATE_ID,
  isMissionTemplateId,
  missionCheckpointCount,
  missionTemplate
} from '../../../shared/content/mission-catalog.ts';
import type {GameEventStream} from '../events/game-events.ts';
import type {StreetEconomyPort} from '../economy/street-economy-controller.ts';
import type {DistrictState, VehicleState} from '../../state.ts';
import type {CollisionMap} from '../../world-map.ts';
import {MissionEntityScope} from './mission-entity-scope.ts';
import {projectMissionState} from './mission-state-projector.ts';
import {
  MissionSystem,
  type FreemodeMission,
  type MissionTransition
} from './mission-system.ts';
import type {MissionCheckpoint} from './mission-objective-system.ts';

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
  economy: StreetEconomyPort;
  clock: () => MissionClock;
  notice: (playerId: string, message: string, tone: GameNotice['tone']) => void;
  releaseDeliveredVehicle: (vehicle: VehicleState, nowMs: number) => void;
}

export class FreemodeMissionController {
  private readonly system = new MissionSystem();
  private readonly entities = new MissionEntityScope();
  private readonly cleanupAt = new Map<string, number>();

  constructor(private readonly options: FreemodeMissionControllerOptions) {}

  start(playerId: string, rawTemplateId: unknown = DEFAULT_MISSION_TEMPLATE_ID): void {
    const {state} = this.options;
    const player = state.players.get(playerId);
    if (!player?.alive) return;
    if (!isMissionTemplateId(rawTemplateId)) {
      this.options.notice(playerId, 'That Freemode job is unavailable.', 'warning');
      return;
    }
    const templateId = rawTemplateId;
    const definition = missionTemplate(templateId);
    if (Math.hypot(player.x - state.missionContactX, player.y - state.missionContactY) > CONTACT_RADIUS) {
      this.options.notice(playerId, 'Meet the orange contact to start work.', 'warning');
      return;
    }
    const clock = this.options.clock();
    let target: VehicleState | undefined;
    let delivery: {x: number; y: number} | undefined;
    if (definition.targetMode === 'reserved-traffic-vehicle') {
      target = [...state.vehicles.values()]
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
      delivery = this.deliveryPoint(target, clock.nowMs);
    }
    const checkpoints = this.checkpointRoute(
      target ?? player,
      delivery,
      clock.nowMs,
      missionCheckpointCount(templateId)
    );
    const result = this.system.start({
      leaderId: playerId,
      templateId,
      targetVehicleId: target?.id,
      deliveryX: delivery?.x,
      deliveryY: delivery?.y,
      checkpoints,
      nowMs: clock.nowMs
    });
    if (!result.ok) {
      const message = result.reason === 'participant-active'
        ? 'You are already assigned to active work.'
        : 'That vehicle is already reserved.';
      this.options.notice(playerId, message, 'warning');
      return;
    }
    if (target) {
      this.entities.track({
        missionId: result.mission.id,
        kind: 'vehicle',
        entityId: target.id,
        disposition: 'release'
      });
    }
    projectMissionState(state.missions, result.mission, state.players, clock.nowMs);
    this.options.notice(
      playerId,
      `${definition.label}: crew forming. Invite nearby drivers or launch now.`,
      'info'
    );
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
      const definition = missionTemplate(mission.templateId);
      const target = definition.targetMode === 'reserved-traffic-vehicle'
        ? state.vehicles.get(mission.targetVehicleId)
        : undefined;
      const transitions = this.system.update(mission.id, {
        nowMs,
        participants: mission.participants.map((participant) => {
          const player = state.players.get(participant.playerId);
          const vehicle = player?.vehicleId ? state.vehicles.get(player.vehicleId) : undefined;
          return {
            playerId: participant.playerId,
            exists: Boolean(player),
            alive: player?.alive ?? false,
            vehicleId: vehicle?.id ?? '',
            wantedLevel: player?.wanted ?? 0,
            x: vehicle?.x ?? player?.x ?? 0,
            y: vehicle?.y ?? player?.y ?? 0
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

  get(missionId: string): FreemodeMission | undefined {
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

  private checkpointRoute(
    start: {x: number; y: number},
    delivery: {x: number; y: number} | undefined,
    nowMs: number,
    count: number
  ): MissionCheckpoint[] {
    const checkpoints: MissionCheckpoint[] = [];
    let previous = {x: start.x, y: start.y};
    for (let index = 0; index < count; index++) {
      let selected = this.options.world.trafficSpawn(nowMs + 1_301 + index * 211, VEHICLE_RADIUS);
      let selectedScore = Number.NEGATIVE_INFINITY;
      for (let attempt = 0; attempt < 48; attempt++) {
        const candidate = this.options.world.trafficSpawn(
          nowMs + 1_301 + index * 211 + attempt * 47,
          VEHICLE_RADIUS
        );
        const previousDistance = Math.hypot(candidate.x - previous.x, candidate.y - previous.y);
        const deliveryDistance = delivery
          ? Math.hypot(candidate.x - delivery.x, candidate.y - delivery.y)
          : Number.POSITIVE_INFINITY;
        const routeDistance = checkpoints.reduce((minimum, checkpoint) => Math.min(
          minimum,
          Math.hypot(candidate.x - checkpoint.x, candidate.y - checkpoint.y)
        ), Number.POSITIVE_INFINITY);
        const score = Math.min(previousDistance, deliveryDistance, routeDistance);
        if (score > selectedScore) {
          selected = candidate;
          selectedScore = score;
        }
        if (
          previousDistance >= 360 &&
          (!delivery || deliveryDistance >= 280) &&
          routeDistance >= 300
        ) break;
      }
      const checkpoint = {
        id: `checkpoint-${index + 1}`,
        x: selected.x,
        y: selected.y,
        radius: 82
      };
      checkpoints.push(checkpoint);
      previous = checkpoint;
    }
    return checkpoints;
  }

  private processTransitions(
    mission: FreemodeMission,
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
        this.broadcast(mission, phaseNotice(transition.phase, mission.objectiveKind), 'info');
      } else if (transition.type === 'leader-transferred') {
        const leaderName = this.options.state.players.get(transition.leaderId)?.name ?? transition.leaderId;
        this.broadcast(mission, `${leaderName} is now crew leader.`, 'warning');
      } else if (transition.type === 'completed') {
        for (const payout of transition.payouts) {
          const result = this.options.economy.credit(
            payout.playerId,
            payout.amount,
            'mission-payout',
            payout.idempotencyKey,
            clock.nowMs
          );
          if (result.status !== 'applied') continue;
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
    mission: FreemodeMission,
    message: string,
    tone: GameNotice['tone']
  ): void {
    for (const participant of mission.participants) {
      this.options.notice(participant.playerId, message, tone);
    }
  }
}

function phaseNotice(phase: string, objectiveKind: string): string {
  if (phase === 'steal') return 'Job launched. Steal the marked vehicle.';
  if (phase === 'checkpoints' && objectiveKind === 'crew-checkpoints') {
    return 'Get any crew vehicle through every marked checkpoint.';
  }
  if (phase === 'checkpoints') return 'Drive the target through every marked checkpoint.';
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
