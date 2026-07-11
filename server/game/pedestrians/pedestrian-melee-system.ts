import {NPC_MELEE} from '../../../shared/content/pedestrian-combat.ts';
import type {DistrictState, NpcState, PlayerState} from '../../state.ts';
import type {CollisionMap} from '../../world-map.ts';
import type {DamageImpact} from '../combat/combat-survivability-policy.ts';
import type {GameEventStream} from '../events/game-events.ts';
import {
  clearPedestrianMelee,
  type PedestrianRuntime
} from './pedestrian-runtime.ts';

interface PedestrianMeleeSystemOptions {
  state: DistrictState;
  world: CollisionMap;
  events?: GameEventStream;
  clock: () => {tick: number};
  damagePlayer?: (
    target: PlayerState,
    damage: number,
    attackerId: string,
    nowMs: number,
    impact: DamageImpact
  ) => void;
}

export class PedestrianMeleeSystem {
  constructor(private readonly options: PedestrianMeleeSystemOptions) {}

  begin(
    npc: NpcState,
    runtime: PedestrianRuntime,
    target: PlayerState,
    nowMs: number
  ): boolean {
    if (runtime.melee.phase !== 'idle' || nowMs < runtime.melee.cooldownUntil) return false;
    const attackAngle = Math.atan2(target.y - npc.y, target.x - npc.x);
    npc.angle = attackAngle;
    if (!this.canContact(npc, target)) return false;
    npc.action = 'melee';
    npc.attackSequence = (npc.attackSequence + 1) >>> 0;
    npc.attackProgress = 0;
    runtime.melee.phase = 'windup';
    runtime.melee.targetId = target.id;
    runtime.melee.startedAt = nowMs;
    runtime.melee.impactAt = nowMs + NPC_MELEE.impactMs;
    runtime.melee.endsAt = nowMs + NPC_MELEE.durationMs;
    runtime.melee.cooldownUntil = runtime.melee.endsAt + NPC_MELEE.recoveryCooldownMs;
    runtime.melee.contactApplied = false;
    this.options.events?.publish({
      type: 'npc.melee.started',
      tick: this.options.clock().tick,
      nowMs,
      npcId: npc.id,
      targetId: target.id,
      x: npc.x,
      y: npc.y
    });
    return true;
  }

  update(npc: NpcState, runtime: PedestrianRuntime, nowMs: number): boolean {
    const melee = runtime.melee;
    if (melee.phase === 'idle') return false;
    const target = this.options.state.players.get(melee.targetId);
    if (!npc.alive || !target?.alive || target.vehicleId || target.spaceId !== 'street') {
      this.interrupt(npc, runtime, nowMs);
      return false;
    }

    npc.action = 'melee';
    npc.attackProgress = clamp(
      (nowMs - melee.startedAt) / Math.max(1, melee.endsAt - melee.startedAt),
      0,
      1
    );
    if (!melee.contactApplied && nowMs >= melee.impactAt) {
      melee.contactApplied = true;
      melee.phase = 'recovery';
      if (this.canContact(npc, target)) {
        this.options.damagePlayer?.(
          target,
          NPC_MELEE.damage,
          npc.id,
          nowMs,
          {family: 'melee', force: 'medium', sourceX: npc.x, sourceY: npc.y}
        );
      }
    }
    if (nowMs < melee.endsAt) return true;
    this.finish(npc, runtime);
    return false;
  }

  interrupt(npc: NpcState, runtime: PedestrianRuntime, nowMs: number): void {
    const cooldownUntil = nowMs + NPC_MELEE.recoveryCooldownMs;
    clearPedestrianMelee(runtime);
    runtime.melee.cooldownUntil = cooldownUntil;
    npc.attackProgress = 1;
    if (npc.action === 'melee') npc.action = 'assault';
  }

  clear(npc: NpcState, runtime: PedestrianRuntime): void {
    clearPedestrianMelee(runtime);
    npc.attackProgress = 1;
    if (npc.action === 'melee') npc.action = 'wander';
  }

  private finish(npc: NpcState, runtime: PedestrianRuntime): void {
    const cooldownUntil = runtime.melee.cooldownUntil;
    clearPedestrianMelee(runtime);
    runtime.melee.cooldownUntil = cooldownUntil;
    npc.attackProgress = 1;
  }

  private canContact(npc: NpcState, target: PlayerState): boolean {
    if (!npc.alive || !target.alive || target.vehicleId || target.spaceId !== 'street') return false;
    const dx = target.x - npc.x;
    const dy = target.y - npc.y;
    if (Math.hypot(dx, dy) > NPC_MELEE.engageDistance) return false;
    const relative = normalizeAngle(Math.atan2(dy, dx) - npc.angle);
    if (Math.abs(relative) > NPC_MELEE.halfArcRadians) return false;
    return this.options.world.hasLineOfSight(npc.x, npc.y, target.x, target.y);
  }
}

function normalizeAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
