import {ACTOR_BURN} from '../../../shared/content/actor-fire.ts';
import type {DistrictState, NpcState, PlayerState} from '../../state.ts';
import type {DamageController} from './damage-controller.ts';

interface BurnRuntime {
  sourceId: string;
  nextDamageAt: number;
}

interface ActorBurnControllerOptions {
  state: DistrictState;
  damage: Pick<DamageController, 'player' | 'npc'>;
}

export class ActorBurnController {
  private readonly runtime = new Map<string, BurnRuntime>();

  constructor(private readonly options: ActorBurnControllerOptions) {}

  ignitePlayer(player: PlayerState, sourceId: string, nowMs: number): boolean {
    if (!player.alive || player.vehicleId) return false;
    return this.ignite('player', player, sourceId, nowMs);
  }

  igniteNpc(npc: NpcState, sourceId: string, nowMs: number): boolean {
    if (!npc.alive) return false;
    return this.ignite('npc', npc, sourceId, nowMs);
  }

  update(nowMs: number): void {
    this.updatePlayers(nowMs);
    this.updateNpcs(nowMs);
    for (const key of this.runtime.keys()) {
      const [kind, id] = splitKey(key);
      const exists = kind === 'player'
        ? this.options.state.players.has(id)
        : this.options.state.npcs.has(id);
      if (!exists) this.runtime.delete(key);
    }
  }

  clearPlayer(player: PlayerState): void {
    this.clear('player', player);
  }

  clearNpc(npc: NpcState): void {
    this.clear('npc', npc);
  }

  private ignite(
    kind: 'player' | 'npc',
    actor: PlayerState | NpcState,
    sourceId: string,
    nowMs: number
  ): boolean {
    const key = burnKey(kind, actor.id);
    const newlyIgnited = !actor.onFire;
    if (newlyIgnited) actor.fireStartedAt = nowMs;
    actor.onFire = true;
    actor.fireExpiresAt = Math.max(actor.fireExpiresAt, nowMs + ACTOR_BURN.durationMs);
    const runtime = this.runtime.get(key);
    if (runtime) runtime.sourceId = sourceId || runtime.sourceId;
    else this.runtime.set(key, {sourceId, nextDamageAt: nowMs});
    return newlyIgnited;
  }

  private updatePlayers(nowMs: number): void {
    for (const player of this.options.state.players.values()) {
      if (!player.onFire) continue;
      const key = burnKey('player', player.id);
      if (!player.alive || nowMs >= player.fireExpiresAt) {
        this.clear('player', player);
        continue;
      }
      const runtime = this.runtime.get(key);
      if (!runtime || nowMs < runtime.nextDamageAt) continue;
      this.options.damage.player(
        player,
        ACTOR_BURN.playerDamage,
        runtime.sourceId,
        nowMs,
        'assault',
        'player',
        burnImpact(player)
      );
      runtime.nextDamageAt = nowMs + ACTOR_BURN.damageIntervalMs;
    }
  }

  private updateNpcs(nowMs: number): void {
    for (const npc of this.options.state.npcs.values()) {
      if (!npc.onFire) continue;
      const key = burnKey('npc', npc.id);
      if (!npc.alive || nowMs >= npc.fireExpiresAt) {
        this.clear('npc', npc);
        continue;
      }
      const runtime = this.runtime.get(key);
      if (!runtime || nowMs < runtime.nextDamageAt) continue;
      this.options.damage.npc(
        npc,
        ACTOR_BURN.npcDamage,
        runtime.sourceId,
        nowMs,
        undefined,
        burnImpact(npc)
      );
      runtime.nextDamageAt = nowMs + ACTOR_BURN.damageIntervalMs;
    }
  }

  private clear(kind: 'player' | 'npc', actor: PlayerState | NpcState): void {
    actor.onFire = false;
    actor.fireStartedAt = 0;
    actor.fireExpiresAt = 0;
    this.runtime.delete(burnKey(kind, actor.id));
  }
}

function burnKey(kind: 'player' | 'npc', id: string): string {
  return `${kind}:${id}`;
}

function splitKey(key: string): ['player' | 'npc', string] {
  const separator = key.indexOf(':');
  return [key.slice(0, separator) as 'player' | 'npc', key.slice(separator + 1)];
}

function burnImpact(actor: {x: number; y: number}): {
  family: 'environment'; force: 'light'; sourceX: number; sourceY: number;
} {
  return {
    family: 'environment',
    force: 'light',
    sourceX: actor.x,
    sourceY: actor.y
  };
}
