import type {DeterministicRandom} from '../world/deterministic-random.ts';
import {NpcState, type DistrictState, type PlayerState, type VehicleState} from '../../state.ts';
import type {CollisionMap} from '../../world-map.ts';
import type {GameEvent, GameEventStream} from '../events/game-events.ts';
import type {DamageImpact} from '../combat/combat-survivability-policy.ts';
import {PedestrianBehaviorSystem} from './pedestrian-behavior-system.ts';
import {PedestrianCombatSystem} from './pedestrian-combat-system.ts';
import {PedestrianLocomotionSystem} from './pedestrian-locomotion-system.ts';
import {PedestrianMeleeSystem} from './pedestrian-melee-system.ts';
import {PedestrianNavigationSystem} from './pedestrian-navigation-system.ts';
import {
  PedestrianPerceptionSystem,
  type PedestrianPoliceTarget
} from './pedestrian-perception-system.ts';
import {
  clearPedestrianReaction,
  clearPedestrianNavigation,
  clearPedestrianStimulus,
  clearPedestrianThreat,
  createPedestrianRuntime,
  type PedestrianRuntime
} from './pedestrian-runtime.ts';
import {PedestrianStimulusAdapter} from './pedestrian-stimulus-adapter.ts';
import {
  PedestrianStimulusRegistry,
  type PedestrianStimulus
} from './pedestrian-stimulus-registry.ts';

export type {PedestrianPoliceTarget} from './pedestrian-perception-system.ts';

export interface PedestrianDiagnostic {
  id: string;
  objective: string;
  bravery: number;
  threatId: string;
  combatTargetId: string;
  panicUntil: number;
  stimulusKind: string;
  stimulusSourceId: string;
  stimulusUntil: number;
  reactionPhase: string;
  meleePhase: string;
  meleeTargetId: string;
  meleeCooldownUntil: number;
  navigationGoalX: number;
  navigationGoalY: number;
  waypointIndex: number;
  waypoints: Array<{x: number; y: number}>;
}

export const PEDESTRIAN_RADIUS = 10;

interface PedestrianControllerOptions {
  state: DistrictState;
  world: CollisionMap;
  random: DeterministicRandom;
  clock: () => {tick: number};
  events?: GameEventStream;
  policeTarget: (officer: NpcState, nowMs: number) => PedestrianPoliceTarget | undefined;
  requestPoliceFire: (
    officerId: string,
    x: number,
    y: number,
    angle: number,
    nowMs: number
  ) => void;
  requestHostileFire?: (
    actorId: string,
    x: number,
    y: number,
    angle: number,
    nowMs: number,
    weapon: 'pistol' | 'smg'
  ) => void;
  damagePlayer?: (
    target: PlayerState,
    damage: number,
    attackerId: string,
    nowMs: number,
    impact: DamageImpact
  ) => void;
  onSpawned?: (npc: NpcState) => void;
  onDespawned?: (npcId: string) => void;
}

export class PedestrianController {
  private readonly runtime = new Map<string, PedestrianRuntime>();
  private readonly perception: PedestrianPerceptionSystem;
  private readonly behavior: PedestrianBehaviorSystem;
  private readonly combat: PedestrianCombatSystem;
  private readonly melee: PedestrianMeleeSystem;
  private readonly navigation: PedestrianNavigationSystem;
  private readonly locomotion: PedestrianLocomotionSystem;
  private readonly stimuli = new PedestrianStimulusRegistry();
  private readonly stimulusAdapter: PedestrianStimulusAdapter;
  private nextEjectedDriverId = 1;

  constructor(private readonly options: PedestrianControllerOptions) {
    this.perception = new PedestrianPerceptionSystem({
      state: options.state,
      policeTarget: options.policeTarget,
      nearestStimulus: (x, y, nowMs) => this.stimuli.nearest(x, y, nowMs)
    });
    this.behavior = new PedestrianBehaviorSystem({
      random: options.random,
      clock: options.clock
    });
    this.combat = new PedestrianCombatSystem(options.world);
    this.melee = new PedestrianMeleeSystem({
      state: options.state,
      world: options.world,
      events: options.events,
      clock: options.clock,
      damagePlayer: options.damagePlayer
    });
    this.navigation = new PedestrianNavigationSystem({
      random: options.random,
      clock: options.clock,
      world: options.world,
      radius: PEDESTRIAN_RADIUS
    });
    this.locomotion = new PedestrianLocomotionSystem(options.world, PEDESTRIAN_RADIUS);
    this.stimulusAdapter = new PedestrianStimulusAdapter({
      state: options.state,
      registry: this.stimuli
    });
  }

  spawn(
    id: string,
    kind: 'civilian' | 'police',
    seed: number,
    minDistance: number,
    maxDistance: number
  ): NpcState {
    const {world, random} = this.options;
    const position = world.openPointNear(
      world.spawn.x,
      world.spawn.y,
      minDistance,
      maxDistance,
      PEDESTRIAN_RADIUS,
      seed,
      true
    );
    return this.spawnAmbientAt(
      id,
      kind,
      position.x,
      position.y,
      random.unit('npc-spawn-angle', `${id}:${seed}`) * Math.PI * 2
    );
  }

  spawnAmbientAt(
    id: string,
    kind: 'civilian' | 'police',
    x: number,
    y: number,
    angle: number
  ): NpcState {
    const existing = this.options.state.npcs.get(id);
    if (existing) return existing;
    const npc = new NpcState();
    npc.id = id;
    npc.kind = kind;
    npc.x = x;
    npc.y = y;
    npc.angle = angle;
    npc.health = healthFor(kind);
    npc.action = 'wander';
    this.options.state.npcs.set(id, npc);
    this.runtime.set(id, createPedestrianRuntime(
      npc.angle,
      this.options.random.range('npc-bravery', id, 0.22, 0.72),
      this.options.random.range('npc-perception-offset', id, 0, 220)
    ));
    this.options.onSpawned?.(npc);
    return npc;
  }

  canStreamOut(npcId: string): boolean {
    const npc = this.options.state.npcs.get(npcId);
    const runtime = this.runtime.get(npcId);
    return Boolean(
      npc?.alive &&
      runtime?.lifecycle === 'ambient' &&
      runtime.objective === 'wander' &&
      !runtime.combatTargetId &&
      !runtime.threatId &&
      !runtime.stimulusId &&
      runtime.reaction.phase === 'none' &&
      runtime.melee.phase === 'idle' &&
      !npc.reactionKind
    );
  }

  streamOutAmbient(npcId: string): boolean {
    if (!this.canStreamOut(npcId)) return false;
    const npc = this.options.state.npcs.get(npcId);
    const runtime = this.runtime.get(npcId);
    if (npc && runtime) this.melee.clear(npc, runtime);
    this.runtime.delete(npcId);
    this.options.state.npcs.delete(npcId);
    this.options.onDespawned?.(npcId);
    return true;
  }

  update(npc: NpcState, deltaSeconds: number, nowMs: number): void {
    const runtime = this.runtime.get(npc.id);
    if (!runtime) return;
    if (!npc.alive) {
      this.melee.clear(npc, runtime);
      npc.action = 'dead';
      this.tryRespawn(npc, runtime, nowMs);
      return;
    }
    if (npc.reactionKind && npc.reactionProgress < 1) {
      if (runtime.melee.phase !== 'idle') this.melee.interrupt(npc, runtime, nowMs);
      npc.action = npc.reactionKind;
      return;
    }
    if (this.melee.update(npc, runtime, nowMs)) return;

    const combatTarget = runtime.combatTargetId
      ? this.options.state.players.get(runtime.combatTargetId)
      : undefined;
    const intent = npc.kind === 'hostile' && combatTarget?.alive
      ? this.combat.decide(npc, runtime, combatTarget, nowMs)
      : this.behavior.decide(npc, runtime, this.perception.observe(npc, runtime, nowMs), nowMs);
    const meleeTarget = intent.meleeTargetId
      ? this.options.state.players.get(intent.meleeTargetId)
      : undefined;
    if (meleeTarget && this.melee.begin(npc, runtime, meleeTarget, nowMs)) return;
    const moveAngle = this.navigation.resolveAngle(npc, runtime, intent, nowMs);
    npc.action = intent.objective;
    npc.angle = moveAngle;
    const avoidRoad = runtime.lifecycle === 'ambient' && intent.objective === 'wander';
    if (!this.locomotion.move(npc, moveAngle, intent.speed, deltaSeconds, avoidRoad)) {
      this.navigation.recoverFromBlock(runtime, npc.id, moveAngle, nowMs);
    }
    if (intent.fire) {
      if (npc.kind === 'hostile') {
        this.options.requestHostileFire?.(
          npc.id,
          npc.x,
          npc.y,
          intent.aimAngle,
          nowMs,
          runtime.combatWeapon
        );
      } else {
        this.options.requestPoliceFire(npc.id, npc.x, npc.y, intent.aimAngle, nowMs);
      }
    }
  }

  beginTick(nowMs: number): void {
    this.stimuli.expire(nowMs);
  }

  observeEvents(events: readonly GameEvent[]): void {
    this.stimulusAdapter.ingest(events);
  }

  diagnostics(): PedestrianDiagnostic[] {
    return [...this.runtime.entries()].map(([id, runtime]) => ({
      id,
      objective: runtime.objective,
      bravery: runtime.bravery,
      threatId: runtime.threatId,
      combatTargetId: runtime.combatTargetId,
      panicUntil: runtime.panicUntil,
      stimulusKind: runtime.stimulusKind,
      stimulusSourceId: runtime.stimulusSourceId,
      stimulusUntil: runtime.stimulusUntil,
      reactionPhase: runtime.reaction.phase,
      meleePhase: runtime.melee.phase,
      meleeTargetId: runtime.melee.targetId,
      meleeCooldownUntil: runtime.melee.cooldownUntil,
      navigationGoalX: runtime.navigation.goalX,
      navigationGoalY: runtime.navigation.goalY,
      waypointIndex: runtime.navigation.waypointIndex,
      waypoints: runtime.navigation.waypoints.map((waypoint) => ({...waypoint}))
    })).sort((left, right) => left.id.localeCompare(right.id));
  }

  stimulusSnapshot(): PedestrianStimulus[] {
    return this.stimuli.snapshot();
  }

  panic(npcId: string, threatId: string, untilMs: number): void {
    const runtime = this.runtime.get(npcId);
    if (!runtime) return;
    this.perception.rememberThreat(runtime, threatId, untilMs);
  }

  scheduleRespawn(npcId: string, respawnAt: number): void {
    const runtime = this.runtime.get(npcId);
    if (runtime?.lifecycle === 'ambient') runtime.respawnAt = respawnAt;
  }

  spawnMissionHostile(
    id: string,
    centerX: number,
    centerY: number,
    minDistance: number,
    maxDistance: number,
    health: number,
    weapon: 'pistol' | 'smg',
    fireCooldownMs: number,
    seed: number
  ): NpcState {
    const position = this.options.world.openPointNear(
      centerX,
      centerY,
      minDistance,
      maxDistance,
      PEDESTRIAN_RADIUS,
      seed
    );
    const npc = new NpcState();
    npc.id = id;
    npc.kind = 'hostile';
    npc.x = position.x;
    npc.y = position.y;
    npc.angle = Math.atan2(centerY - position.y, centerX - position.x);
    npc.health = Math.max(25, Math.min(200, Math.floor(health)));
    npc.action = 'assault';
    this.options.state.npcs.set(id, npc);
    this.runtime.set(id, {
      ...createPedestrianRuntime(npc.angle, 1, 0),
      lifecycle: 'mission',
      objective: 'assault',
      combatWeapon: weapon,
      combatFireCooldownMs: Math.max(250, Math.min(2_000, Math.floor(fireCooldownMs)))
    });
    this.options.onSpawned?.(npc);
    return npc;
  }

  assignCombatTarget(npcId: string, playerId: string): void {
    const runtime = this.runtime.get(npcId);
    if (runtime?.lifecycle === 'mission') runtime.combatTargetId = playerId;
  }

  despawn(npcId: string): boolean {
    const runtime = this.runtime.get(npcId);
    if (!runtime || runtime.lifecycle !== 'mission') return false;
    const npc = this.options.state.npcs.get(npcId);
    if (npc) this.melee.clear(npc, runtime);
    this.runtime.delete(npcId);
    this.options.state.npcs.delete(npcId);
    this.options.onDespawned?.(npcId);
    return true;
  }

  spawnEjectedDriver(vehicle: VehicleState, hijacker: PlayerState, nowMs: number): string {
    const id = `ejected-driver-${this.nextEjectedDriverId++}`;
    const sideAngle = vehicle.angle - Math.PI / 2;
    const preferredX = vehicle.x + Math.cos(sideAngle) * 48;
    const preferredY = vehicle.y + Math.sin(sideAngle) * 48;
    const position = this.options.world.canOccupy(preferredX, preferredY, PEDESTRIAN_RADIUS)
      ? {x: preferredX, y: preferredY}
      : this.options.world.openPointNear(
        vehicle.x,
        vehicle.y,
        38,
        86,
        PEDESTRIAN_RADIUS,
        nowMs
      );
    const npc = new NpcState();
    npc.id = id;
    npc.kind = 'civilian';
    npc.x = position.x;
    npc.y = position.y;
    npc.angle = Math.atan2(position.y - vehicle.y, position.x - vehicle.x);
    npc.health = healthFor(npc.kind);
    npc.action = 'startle';
    npc.ejectedAt = nowMs;
    this.options.state.npcs.set(id, npc);
    this.runtime.set(id, {
      ...createPedestrianRuntime(
        npc.angle,
        this.options.random.range('npc-bravery', id, 0.22, 0.72),
        nowMs + this.options.random.range('npc-perception-offset', id, 0, 220)
      ),
      nextThinkAt: nowMs + 1100,
      panicUntil: nowMs + 4500,
      threatId: hijacker.id
    });
    this.options.onSpawned?.(npc);
    return id;
  }

  private tryRespawn(npc: NpcState, runtime: PedestrianRuntime, nowMs: number): void {
    if (runtime.lifecycle === 'mission') return;
    if (nowMs < runtime.respawnAt) return;
    const position = this.options.world.openPointNear(
      this.options.world.spawn.x,
      this.options.world.spawn.y,
      npc.kind === 'police' ? 420 : 180,
      npc.kind === 'police' ? 900 : 800,
      PEDESTRIAN_RADIUS,
      nowMs + npc.id.length,
      true
    );
    npc.x = position.x;
    npc.y = position.y;
    npc.health = healthFor(npc.kind);
    npc.armor = 0;
    npc.alive = true;
    npc.action = 'wander';
    npc.attackProgress = 1;
    npc.reactionKind = '';
    npc.reactionProgress = 1;
    npc.ejectedAt = 0;
    clearPedestrianThreat(runtime);
    clearPedestrianStimulus(runtime);
    clearPedestrianReaction(runtime);
    this.melee.clear(npc, runtime);
    clearPedestrianNavigation(runtime);
    runtime.objective = 'wander';
    runtime.avoidUntil = 0;
    runtime.respawnAt = 0;
  }
}

function healthFor(kind: string): number {
  return kind === 'police' ? 100 : 50;
}
