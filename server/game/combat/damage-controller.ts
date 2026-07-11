import type {GameEventStream} from '../events/game-events.ts';
import type {CrimeKind} from '../incidents/crime-policy.ts';
import type {CrimeResponseController} from '../police/crime-response-controller.ts';
import type {PlayerLifecycleController} from '../players/player-lifecycle-controller.ts';
import type {StreetEconomyPort} from '../economy/street-economy-controller.ts';
import type {NpcState, PlayerState} from '../../state.ts';
import {
  resolveDamage,
  type DamageImpact,
  type DamageResolution
} from './combat-survivability-policy.ts';

interface CombatReactionPort {
  player: (
    target: PlayerState,
    impact: DamageImpact,
    result: DamageResolution & {previousHealth: number},
    nowMs: number
  ) => boolean;
  npc: (
    target: NpcState,
    impact: DamageImpact,
    result: DamageResolution & {previousHealth: number},
    nowMs: number
  ) => boolean;
  clearPlayer: (playerId: string) => void;
  clearNpc: (npcId: string) => void;
}

interface DamageControllerOptions {
  events: GameEventStream;
  economy: StreetEconomyPort;
  crime: CrimeResponseController;
  playerLifecycle: PlayerLifecycleController;
  reactions?: CombatReactionPort;
  clock: () => {tick: number};
  panicNpc: (npcId: string, attackerId: string, untilMs: number) => void;
  scheduleNpcRespawn: (npcId: string, respawnAt: number) => void;
}

export class DamageController {
  constructor(private readonly options: DamageControllerOptions) {}

  player(
    target: PlayerState,
    damage: number,
    attackerId: string,
    nowMs: number,
    crimeKind: CrimeKind = 'assault',
    attackerDisposition: 'player' | 'non-player' = 'player',
    impact: DamageImpact = defaultImpact(target)
  ): DamageResolution | undefined {
    if (
      !target.alive ||
      damage <= 0 ||
      this.options.playerLifecycle.isProtected?.(target.id, nowMs)
    ) return undefined;
    const previousHealth = target.health;
    const result = resolveDamage(target.health, target.armor, damage, impact.bypassArmor);
    if (result.acceptedDamage <= 0) return undefined;
    target.armor = result.remainingArmor;
    target.health = result.remainingHealth;
    this.options.events.publish({
      type: 'damage.applied',
      tick: this.options.clock().tick,
      nowMs,
      targetId: target.id,
      targetKind: 'player',
      attackerId,
      amount: result.acceptedDamage,
      armorDamage: result.armorDamage,
      healthDamage: result.healthDamage,
      remainingArmor: target.armor,
      remainingHealth: target.health
    });
    if (attackerId && attackerId !== target.id && attackerDisposition === 'player') {
      this.options.crime.record(attackerId, crimeKind, nowMs, target.id, target.x, target.y);
    }
    if (target.health > 0) {
      this.options.reactions?.player(target, impact, {...result, previousHealth}, nowMs);
      return result;
    }

    this.options.reactions?.clearPlayer(target.id);

    if (attackerId && attackerId !== target.id && attackerDisposition === 'player') {
      this.options.economy.credit(
        attackerId,
        100,
        'player-kill',
        `kill:player:${target.id}:${this.options.clock().tick}`,
        nowMs
      );
      this.options.crime.record(attackerId, 'murder', nowMs, target.id, target.x, target.y);
    }
    this.options.playerLifecycle.kill(target, nowMs, attackerId);
    return result;
  }

  npc(
    target: NpcState,
    damage: number,
    attackerId: string,
    nowMs: number,
    crimeKind: CrimeKind = target.kind === 'police' ? 'assault-police' : 'assault',
    impact: DamageImpact = defaultImpact(target)
  ): DamageResolution | undefined {
    if (!target.alive || damage <= 0) return undefined;
    const missionHostile = target.kind === 'hostile';
    const previousHealth = target.health;
    const result = resolveDamage(target.health, target.armor, damage, impact.bypassArmor);
    if (result.acceptedDamage <= 0) return undefined;
    target.armor = result.remainingArmor;
    target.health = result.remainingHealth;
    this.options.events.publish({
      type: 'damage.applied',
      tick: this.options.clock().tick,
      nowMs,
      targetId: target.id,
      targetKind: 'npc',
      attackerId,
      amount: result.acceptedDamage,
      armorDamage: result.armorDamage,
      healthDamage: result.healthDamage,
      remainingArmor: target.armor,
      remainingHealth: target.health
    });
    if (attackerId && !missionHostile) {
      this.options.crime.record(attackerId, crimeKind, nowMs, target.id, target.x, target.y);
    }
    if (!missionHostile) this.options.panicNpc(target.id, attackerId, nowMs + 4500);
    if (target.health > 0) {
      this.options.reactions?.npc(target, impact, {...result, previousHealth}, nowMs);
      return result;
    }

    this.options.reactions?.clearNpc(target.id);
    target.alive = false;
    this.options.events.publish({
      type: 'entity.killed',
      tick: this.options.clock().tick,
      nowMs,
      entityId: target.id,
      entityKind: 'npc',
      attackerId
    });
    if (!missionHostile) this.options.scheduleNpcRespawn(target.id, nowMs + 5500);
    if (attackerId && !missionHostile) {
      this.options.economy.credit(
        attackerId,
        target.kind === 'police' ? 200 : 50,
        target.kind === 'police' ? 'police-kill' : 'civilian-kill',
        `kill:npc:${target.id}:${this.options.clock().tick}`,
        nowMs
      );
    }
    if (attackerId && !missionHostile) {
      this.options.crime.record(
        attackerId,
        target.kind === 'police' ? 'murder-police' : 'murder',
        nowMs,
        target.id,
        target.x,
        target.y
      );
    }
    return result;
  }
}

function defaultImpact(target: PlayerState | NpcState): DamageImpact {
  return {
    family: 'environment',
    force: 'light',
    sourceX: target.x + Math.cos(target.angle),
    sourceY: target.y + Math.sin(target.angle)
  };
}
