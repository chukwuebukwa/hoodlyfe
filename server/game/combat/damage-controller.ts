import type {GameEventStream} from '../events/game-events.ts';
import type {CrimeKind} from '../incidents/crime-policy.ts';
import type {CrimeResponseController} from '../police/crime-response-controller.ts';
import type {PlayerLifecycleController} from '../players/player-lifecycle-controller.ts';
import type {StreetEconomyPort} from '../economy/street-economy-controller.ts';
import type {NpcState, PlayerState} from '../../state.ts';

interface DamageControllerOptions {
  events: GameEventStream;
  economy: StreetEconomyPort;
  crime: CrimeResponseController;
  playerLifecycle: PlayerLifecycleController;
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
    attackerDisposition: 'player' | 'non-player' = 'player'
  ): void {
    if (
      !target.alive ||
      damage <= 0 ||
      this.options.playerLifecycle.isProtected?.(target.id, nowMs)
    ) return;
    const previousHealth = target.health;
    target.health = Math.max(0, target.health - damage);
    this.options.events.publish({
      type: 'damage.applied',
      tick: this.options.clock().tick,
      nowMs,
      targetId: target.id,
      targetKind: 'player',
      attackerId,
      amount: previousHealth - target.health,
      remainingHealth: target.health
    });
    if (attackerId && attackerDisposition === 'player') {
      this.options.crime.record(attackerId, crimeKind, nowMs, target.id, target.x, target.y);
    }
    if (target.health > 0) return;

    if (attackerId && attackerDisposition === 'player') {
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
  }

  npc(
    target: NpcState,
    damage: number,
    attackerId: string,
    nowMs: number,
    crimeKind: CrimeKind = target.kind === 'police' ? 'assault-police' : 'assault'
  ): void {
    if (!target.alive || damage <= 0) return;
    const missionHostile = target.kind === 'hostile';
    const previousHealth = target.health;
    target.health = Math.max(0, target.health - damage);
    this.options.events.publish({
      type: 'damage.applied',
      tick: this.options.clock().tick,
      nowMs,
      targetId: target.id,
      targetKind: 'npc',
      attackerId,
      amount: previousHealth - target.health,
      remainingHealth: target.health
    });
    if (attackerId && !missionHostile) {
      this.options.crime.record(attackerId, crimeKind, nowMs, target.id, target.x, target.y);
    }
    if (!missionHostile) this.options.panicNpc(target.id, attackerId, nowMs + 4500);
    if (target.health > 0) return;

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
  }
}
