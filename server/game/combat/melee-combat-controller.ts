import {
  WEAPONS,
  type MeleeStrikeDefinition,
  type MeleeWeaponDefinition,
  type MeleeWeaponId
} from '../../../shared/content/weapon-catalog.ts';
import type {DistrictState, NpcState, PlayerState, VehicleState} from '../../state.ts';
import type {CollisionMap} from '../../world-map.ts';
import type {GameEventStream} from '../events/game-events.ts';
import {classifyImpactZone} from '../vehicles/vehicle-damage-system.ts';
import {selectMeleeTargets, type MeleeTargetCandidate} from './melee-hit-policy.ts';
import type {DamageImpact} from './combat-survivability-policy.ts';

const PLAYER_RADIUS = 11;
const NPC_RADIUS = 10;
const VEHICLE_RADIUS = 20;

interface MeleeCombatControllerOptions {
  state: DistrictState;
  world: CollisionMap;
  events: GameEventStream;
  clock: () => {tick: number};
  cancelSpawnProtection?: (playerId: string) => void;
  queryPlayers: (x: number, y: number, radius: number) => PlayerState[];
  queryNpcs: (x: number, y: number, radius: number) => NpcState[];
  queryVehicles: (x: number, y: number, radius: number) => VehicleState[];
  damagePlayer: (
    target: PlayerState,
    damage: number,
    attackerId: string,
    nowMs: number,
    impact: DamageImpact
  ) => void;
  damageNpc: (
    target: NpcState,
    damage: number,
    attackerId: string,
    nowMs: number,
    impact: DamageImpact
  ) => void;
  damageVehicle: (
    target: VehicleState,
    damage: number,
    attackerId: string,
    nowMs: number,
    zone: 'front' | 'rear' | 'left' | 'right'
  ) => void;
}

interface ActiveMeleeAttack {
  weapon: MeleeWeaponId;
  combo: number;
  startedAt: number;
  impactAt: number;
  endsAt: number;
  contactApplied: boolean;
  queued: boolean;
}

interface ComboMemory {
  weapon: MeleeWeaponId;
  combo: number;
  completedAt: number;
}

export interface BeginMeleeResult {
  accepted: boolean;
  combo: number;
}

export class MeleeCombatController {
  private readonly active = new Map<string, ActiveMeleeAttack>();
  private readonly combos = new Map<string, ComboMemory>();

  constructor(private readonly options: MeleeCombatControllerOptions) {}

  begin(playerId: string, weapon: MeleeWeaponId, nowMs: number): BeginMeleeResult {
    const player = this.options.state.players.get(playerId);
    const definition = WEAPONS[weapon] as MeleeWeaponDefinition;
    const active = this.active.get(playerId);
    if (player?.action === 'melee' && active?.weapon === weapon) {
      if (nowMs < active.impactAt) return {accepted: false, combo: active.combo};
      active.queued = true;
      return {
        accepted: true,
        combo: (active.combo + 1) % definition.strikes.length
      };
    }
    if (
      !player?.alive ||
      player.weapon !== weapon ||
      player.spaceId !== 'street' ||
      player.vehicleId ||
      player.action ||
      definition.fireMode !== 'melee'
    ) {
      return {accepted: false, combo: 0};
    }

    const combo = this.nextCombo(playerId, definition, nowMs);
    this.startAttack(player, definition, combo, nowMs);
    return {accepted: true, combo};
  }

  update(nowMs: number): void {
    for (const [playerId, attack] of this.active) {
      const player = this.options.state.players.get(playerId);
      if (!player?.alive || player.action !== 'melee') {
        this.active.delete(playerId);
        continue;
      }
      player.attackProgress = clamp(
        (nowMs - attack.startedAt) / Math.max(1, attack.endsAt - attack.startedAt),
        0,
        1
      );
      if (!attack.contactApplied && nowMs >= attack.impactAt) {
        attack.contactApplied = true;
        this.applyContact(player, attack, nowMs);
      }
      if (nowMs < attack.endsAt) continue;
      this.combos.set(playerId, {
        weapon: attack.weapon,
        combo: attack.combo,
        completedAt: attack.endsAt
      });
      if (attack.queued && player.weapon === attack.weapon) {
        this.active.delete(playerId);
        const definition = WEAPONS[attack.weapon] as MeleeWeaponDefinition;
        this.startAttack(
          player,
          definition,
          (attack.combo + 1) % definition.strikes.length,
          nowMs
        );
        continue;
      }
      this.clearAction(player);
      this.active.delete(playerId);
    }
  }

  clearPlayer(playerId: string): void {
    const player = this.options.state.players.get(playerId);
    if (player?.action === 'melee') this.clearAction(player);
    this.active.delete(playerId);
    this.combos.delete(playerId);
  }

  isActive(playerId: string): boolean {
    return this.active.has(playerId);
  }

  private nextCombo(playerId: string, definition: MeleeWeaponDefinition, nowMs: number): number {
    const previous = this.combos.get(playerId);
    if (
      !previous ||
      previous.weapon !== definition.id ||
      nowMs - previous.completedAt > definition.comboResetMs
    ) {
      return 0;
    }
    return (previous.combo + 1) % definition.strikes.length;
  }

  private startAttack(
    player: PlayerState,
    definition: MeleeWeaponDefinition,
    combo: number,
    nowMs: number
  ): void {
    const strike = definition.strikes[combo];
    const preferred = this.targets(player, strike)[0];
    if (preferred) player.angle = Math.atan2(preferred.y - player.y, preferred.x - player.x);
    player.action = 'melee';
    player.actionUntil = nowMs + strike.durationMs;
    player.actionVehicleId = '';
    player.attackSequence = (player.attackSequence + 1) >>> 0;
    player.attackCombo = combo;
    player.attackProgress = 0;
    this.active.set(player.id, {
      weapon: definition.id,
      combo,
      startedAt: nowMs,
      impactAt: nowMs + strike.impactMs,
      endsAt: nowMs + strike.durationMs,
      contactApplied: false,
      queued: false
    });
    this.options.cancelSpawnProtection?.(player.id);
    this.options.events.publish({
      type: 'melee.started',
      tick: this.options.clock().tick,
      nowMs,
      playerId: player.id,
      weapon: definition.id,
      combo,
      x: player.x,
      y: player.y
    });
  }

  private applyContact(player: PlayerState, attack: ActiveMeleeAttack, nowMs: number): void {
    const definition = WEAPONS[attack.weapon] as MeleeWeaponDefinition;
    const strike = definition.strikes[attack.combo];
    const targets = this.targets(player, strike);
    const impact: DamageImpact = {
      family: 'melee',
      force: attack.weapon === 'bat' ? 'heavy' : 'medium',
      sourceX: player.x,
      sourceY: player.y
    };
    for (const target of targets) {
      if (target.kind === 'player') {
        const victim = this.options.state.players.get(target.id);
        if (victim) this.options.damagePlayer(victim, strike.damage, player.id, nowMs, impact);
      } else if (target.kind === 'npc') {
        const victim = this.options.state.npcs.get(target.id);
        if (victim) this.options.damageNpc(victim, strike.damage, player.id, nowMs, impact);
      } else if (strike.vehicleDamage > 0) {
        const vehicle = this.options.state.vehicles.get(target.id);
        if (!vehicle) continue;
        this.options.damageVehicle(
          vehicle,
          strike.vehicleDamage,
          player.id,
          nowMs,
          classifyImpactZone(vehicle.angle, -Math.cos(player.angle), -Math.sin(player.angle))
        );
      }
    }
  }

  private targets(player: PlayerState, strike: MeleeStrikeDefinition) {
    const queryRadius = strike.range + VEHICLE_RADIUS;
    const candidates: MeleeTargetCandidate[] = [];
    for (const target of this.options.queryPlayers(player.x, player.y, queryRadius)) {
      if (
        target.id === player.id ||
        !target.alive ||
        target.vehicleId ||
        target.spaceId !== player.spaceId ||
        target.surfaceId !== player.surfaceId
      ) continue;
      candidates.push(this.candidate('player', target, PLAYER_RADIUS, player));
    }
    for (const target of this.options.queryNpcs(player.x, player.y, queryRadius)) {
      if (
        !target.alive || player.spaceId !== 'street' || target.surfaceId !== player.surfaceId
      ) continue;
      candidates.push(this.candidate('npc', target, NPC_RADIUS, player));
    }
    for (const target of this.options.queryVehicles(player.x, player.y, queryRadius)) {
      if (player.spaceId !== 'street' || target.surfaceId !== player.surfaceId) continue;
      candidates.push({
        ...this.candidate('vehicle', target, VEHICLE_RADIUS, player),
        targetable: !target.destroyed
      });
    }
    return selectMeleeTargets(player.x, player.y, player.angle, strike, candidates);
  }

  private candidate(
    kind: MeleeTargetCandidate['kind'],
    target: {id: string; x: number; y: number},
    radius: number,
    source: PlayerState
  ): MeleeTargetCandidate {
    return {
      id: target.id,
      kind,
      x: target.x,
      y: target.y,
      radius,
      lineOfSight: this.options.world.hasLineOfSight(
        source.x,
        source.y,
        target.x,
        target.y,
        source.surfaceId,
        'player'
      )
    };
  }

  private clearAction(player: PlayerState): void {
    if (player.action !== 'melee') return;
    player.action = '';
    player.actionUntil = 0;
    player.actionVehicleId = '';
    player.attackProgress = 1;
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
