import type {DebugPoliceArrestEntry} from '../../../shared/protocol/debug.ts';
import type {DistrictState, NpcState, PlayerState} from '../../state.ts';
import type {CollisionMap} from '../../world-map.ts';
import type {GameEventStream} from '../events/game-events.ts';
import type {PoliceTactic} from './pursuit-coordinator.ts';
import {decidePoliceForce, POLICE_ARREST} from './police-force-policy.ts';

interface ArrestTarget {
  player: PlayerState;
  canSeeTarget: boolean;
  targetDistance: number;
  tactic: PoliceTactic;
}

interface PoliceArrestControllerOptions {
  state: DistrictState;
  world: CollisionMap;
  events: GameEventStream;
  clock: () => {tick: number};
  targetFor: (officer: NpcState, nowMs: number) => ArrestTarget | undefined;
  completeArrest: (
    player: PlayerState,
    arrestId: string,
    officerId: string,
    wantedLevel: number,
    nowMs: number
  ) => boolean;
  interruptPlayer: (player: PlayerState) => void;
  resetInput: (playerId: string) => void;
  recordTactic: (officerId: string, x: number, y: number) => void;
}

interface ActiveArrest {
  id: string;
  officerId: string;
  suspectId: string;
  wantedLevel: number;
  startedAt: number;
  completesAt: number;
}

export class PoliceArrestController {
  private readonly bySuspect = new Map<string, ActiveArrest>();
  private readonly suspectByOfficer = new Map<string, string>();

  constructor(private readonly options: PoliceArrestControllerOptions) {}

  request(officerId: string, suspectId: string, nowMs: number): boolean {
    const existing = this.bySuspect.get(suspectId);
    if (existing) return existing.officerId === officerId;
    if (this.suspectByOfficer.has(officerId)) return false;
    const officer = this.options.state.npcs.get(officerId);
    const target = officer ? this.options.targetFor(officer, nowMs) : undefined;
    if (!officer || !target || target.player.id !== suspectId) return false;
    const decision = decidePoliceForce(forceContext(officer, target));
    if (decision.response !== 'arrest') return false;

    const arrest: ActiveArrest = {
      id: `arrest:${suspectId}:${this.options.clock().tick}`,
      officerId,
      suspectId,
      wantedLevel: target.player.wanted,
      startedAt: nowMs,
      completesAt: nowMs + POLICE_ARREST.durationMs
    };
    this.bySuspect.set(suspectId, arrest);
    this.suspectByOfficer.set(officerId, suspectId);
    this.options.interruptPlayer(target.player);
    lockPlayer(target.player);
    holdOfficer(officer, target.player);
    this.options.resetInput(suspectId);
    this.options.recordTactic(officerId, target.player.x, target.player.y);
    this.options.events.publish({
      type: 'police.arrest-started',
      tick: this.options.clock().tick,
      nowMs,
      arrestId: arrest.id,
      officerId,
      suspectId,
      wantedLevel: arrest.wantedLevel
    });
    return true;
  }

  update(nowMs: number): void {
    for (const arrest of [...this.bySuspect.values()]) {
      const officer = this.options.state.npcs.get(arrest.officerId);
      const player = this.options.state.players.get(arrest.suspectId);
      if (!officer || !player || !this.canContinue(officer, player)) {
        this.cancel(arrest, nowMs, 'invalid-contact');
        continue;
      }
      lockPlayer(player);
      holdOfficer(officer, player);
      this.options.resetInput(player.id);
      this.options.recordTactic(officer.id, player.x, player.y);
      if (nowMs < arrest.completesAt) continue;
      if (!this.options.completeArrest(
        player,
        arrest.id,
        officer.id,
        arrest.wantedLevel,
        nowMs
      )) {
        this.cancel(arrest, nowMs, 'outcome-rejected');
        continue;
      }
      officer.action = 'wander';
      this.release(arrest);
    }
  }

  holdsOfficer(officerId: string): boolean {
    return this.suspectByOfficer.has(officerId);
  }

  holdsPlayer(playerId: string): boolean {
    return this.bySuspect.has(playerId);
  }

  clearPlayer(playerId: string, nowMs: number): void {
    const arrest = this.bySuspect.get(playerId);
    if (arrest) this.cancel(arrest, nowMs, 'player-left');
  }

  diagnostics(): DebugPoliceArrestEntry[] {
    return [...this.bySuspect.values()].flatMap((arrest) => {
      const officer = this.options.state.npcs.get(arrest.officerId);
      const player = this.options.state.players.get(arrest.suspectId);
      if (!officer || !player) return [];
      return [{
        arrestId: arrest.id,
        officerId: arrest.officerId,
        suspectId: arrest.suspectId,
        phase: 'securing' as const,
        startedAt: arrest.startedAt,
        completesAt: arrest.completesAt,
        wantedLevel: arrest.wantedLevel,
        officerX: officer.x,
        officerY: officer.y,
        suspectX: player.x,
        suspectY: player.y
      }];
    }).sort((left, right) => left.arrestId.localeCompare(right.arrestId));
  }

  private canContinue(officer: NpcState, player: PlayerState): boolean {
    return officer.alive &&
      officer.health > 0 &&
      !officer.reactionKind &&
      player.alive &&
      player.wanted > 0 &&
      player.action === 'arrested' &&
      !player.vehicleId &&
      player.spaceId === 'street' &&
      Math.hypot(player.x - officer.x, player.y - officer.y) <= POLICE_ARREST.breakDistance &&
      this.options.world.hasLineOfSight(officer.x, officer.y, player.x, player.y);
  }

  private cancel(arrest: ActiveArrest, nowMs: number, reason: string): void {
    const officer = this.options.state.npcs.get(arrest.officerId);
    const player = this.options.state.players.get(arrest.suspectId);
    if (officer?.action === 'arrest') officer.action = 'pursue';
    if (player?.action === 'arrested') {
      player.action = '';
      player.actionUntil = 0;
      player.actionVehicleId = '';
    }
    this.options.events.publish({
      type: 'police.arrest-cancelled',
      tick: this.options.clock().tick,
      nowMs,
      arrestId: arrest.id,
      officerId: arrest.officerId,
      suspectId: arrest.suspectId,
      reason
    });
    this.release(arrest);
  }

  private release(arrest: ActiveArrest): void {
    this.bySuspect.delete(arrest.suspectId);
    this.suspectByOfficer.delete(arrest.officerId);
  }
}

function forceContext(officer: NpcState, target: ArrestTarget) {
  return {
    role: target.tactic.role,
    officerInControl: officer.alive && officer.health > 0 && !officer.reactionKind,
    targetAlive: target.player.alive,
    targetWantedLevel: target.player.wanted,
    targetAction: target.player.action,
    targetOnFootInStreet: !target.player.vehicleId && target.player.spaceId === 'street',
    canSeeTarget: target.canSeeTarget,
    targetDistance: target.targetDistance
  };
}

function lockPlayer(player: PlayerState): void {
  player.action = 'arrested';
  player.actionUntil = Number.MAX_SAFE_INTEGER;
  player.actionVehicleId = '';
}

function holdOfficer(officer: NpcState, player: PlayerState): void {
  officer.action = 'arrest';
  officer.angle = Math.atan2(player.y - officer.y, player.x - officer.x);
  player.angle = Math.atan2(officer.y - player.y, officer.x - player.x);
}
