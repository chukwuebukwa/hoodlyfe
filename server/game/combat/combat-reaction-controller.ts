import type {DistrictState, NpcState, PlayerState} from '../../state.ts';
import {
  impactDirection,
  reactionDurationMs,
  reactionKindFor,
  reactionPriority,
  type DamageImpact,
  type ReactionKind
} from './combat-survivability-policy.ts';

interface ReactionResult {
  acceptedDamage: number;
  previousHealth: number;
  remainingHealth: number;
}

interface ActiveReaction {
  targetKind: 'player' | 'npc';
  kind: Exclude<ReactionKind, ''>;
  startedAt: number;
  endsAt: number;
}

interface CombatReactionControllerOptions {
  state: DistrictState;
  interruptPlayer: (player: PlayerState) => void;
}

export class CombatReactionController {
  private readonly active = new Map<string, ActiveReaction>();

  constructor(private readonly options: CombatReactionControllerOptions) {}

  player(
    target: PlayerState,
    impact: DamageImpact,
    result: ReactionResult,
    nowMs: number
  ): boolean {
    if (!target.alive || result.remainingHealth <= 0) {
      this.clearPlayer(target.id);
      return false;
    }
    const kind = reactionKindFor({...impact, ...result});
    if (!this.canStart('player', target.id, kind)) return false;
    this.start(target, 'player', kind, impact, nowMs);
    if (impact.family !== 'bullet') {
      this.options.interruptPlayer(target);
      target.action = kind === 'knockdown' ? 'knockdown' : 'hit';
      target.actionUntil = nowMs + reactionDurationMs(kind);
      target.actionVehicleId = '';
    }
    return true;
  }

  npc(
    target: NpcState,
    impact: DamageImpact,
    result: ReactionResult,
    nowMs: number
  ): boolean {
    if (!target.alive || result.remainingHealth <= 0) {
      this.clearNpc(target.id);
      return false;
    }
    const kind = reactionKindFor({...impact, ...result});
    if (!this.canStart('npc', target.id, kind)) return false;
    this.start(target, 'npc', kind, impact, nowMs);
    target.action = kind;
    return true;
  }

  update(nowMs: number): void {
    for (const [key, reaction] of this.active) {
      const target = reaction.targetKind === 'player'
        ? this.options.state.players.get(entityId(key))
        : this.options.state.npcs.get(entityId(key));
      if (!target?.alive) {
        this.active.delete(key);
        continue;
      }
      target.reactionProgress = clamp(
        (nowMs - reaction.startedAt) / Math.max(1, reaction.endsAt - reaction.startedAt),
        0,
        1
      );
      if (nowMs < reaction.endsAt) continue;
      target.reactionKind = '';
      target.reactionProgress = 1;
      if (reaction.targetKind === 'player') {
        const player = target as PlayerState;
        if (player.action === 'hit' || player.action === 'knockdown') {
          player.action = '';
          player.actionUntil = 0;
          player.actionVehicleId = '';
        }
      } else if (target.action === 'flinch' || target.action === 'stagger' || target.action === 'knockdown') {
        target.action = 'wander';
      }
      this.active.delete(key);
    }
  }

  isActive(targetKind: 'player' | 'npc', targetId: string): boolean {
    return this.active.has(keyFor(targetKind, targetId));
  }

  clearPlayer(playerId: string): void {
    const target = this.options.state.players.get(playerId);
    if (target) this.clearState(target);
    this.active.delete(keyFor('player', playerId));
  }

  clearNpc(npcId: string): void {
    const target = this.options.state.npcs.get(npcId);
    if (target) this.clearState(target);
    this.active.delete(keyFor('npc', npcId));
  }

  private canStart(
    targetKind: 'player' | 'npc',
    targetId: string,
    kind: Exclude<ReactionKind, ''>
  ): boolean {
    const current = this.active.get(keyFor(targetKind, targetId));
    return !current || reactionPriority(kind) > reactionPriority(current.kind);
  }

  private start(
    target: PlayerState | NpcState,
    targetKind: 'player' | 'npc',
    kind: Exclude<ReactionKind, ''>,
    impact: DamageImpact,
    nowMs: number
  ): void {
    const duration = reactionDurationMs(kind);
    target.reactionSequence = (target.reactionSequence + 1) >>> 0;
    target.reactionKind = kind;
    target.reactionDirection = impactDirection(
      target.x,
      target.y,
      target.angle,
      impact.sourceX,
      impact.sourceY
    );
    target.reactionProgress = 0;
    this.active.set(keyFor(targetKind, target.id), {
      targetKind,
      kind,
      startedAt: nowMs,
      endsAt: nowMs + duration
    });
  }

  private clearState(target: PlayerState | NpcState): void {
    target.reactionKind = '';
    target.reactionProgress = 1;
  }
}

function keyFor(targetKind: 'player' | 'npc', targetId: string): string {
  return `${targetKind}:${targetId}`;
}

function entityId(key: string): string {
  return key.slice(key.indexOf(':') + 1);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
