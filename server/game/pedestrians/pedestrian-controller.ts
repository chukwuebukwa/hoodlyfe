import type {DeterministicRandom} from '../world/deterministic-random.ts';
import {NpcState, type DistrictState, type PlayerState, type VehicleState} from '../../state.ts';
import type {CollisionMap} from '../../world-map.ts';
import type {GameEvent} from '../events/game-events.ts';
import {PedestrianBehaviorSystem} from './pedestrian-behavior-system.ts';
import {PedestrianLocomotionSystem} from './pedestrian-locomotion-system.ts';
import {PedestrianNavigationSystem} from './pedestrian-navigation-system.ts';
import {
  PedestrianPerceptionSystem,
  type PedestrianPoliceTarget
} from './pedestrian-perception-system.ts';
import {
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
  panicUntil: number;
  stimulusKind: string;
  stimulusSourceId: string;
  stimulusUntil: number;
}

export const PEDESTRIAN_RADIUS = 10;

interface PedestrianControllerOptions {
  state: DistrictState;
  world: CollisionMap;
  random: DeterministicRandom;
  clock: () => {tick: number};
  policeTarget: (officer: NpcState, nowMs: number) => PedestrianPoliceTarget | undefined;
  requestPoliceFire: (
    officerId: string,
    x: number,
    y: number,
    angle: number,
    nowMs: number
  ) => void;
  onSpawned?: (npc: NpcState) => void;
}

export class PedestrianController {
  private readonly runtime = new Map<string, PedestrianRuntime>();
  private readonly perception: PedestrianPerceptionSystem;
  private readonly behavior: PedestrianBehaviorSystem;
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
    this.navigation = new PedestrianNavigationSystem({
      random: options.random,
      clock: options.clock
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
    const {world, random, state} = this.options;
    const position = world.openPointNear(
      world.spawn.x,
      world.spawn.y,
      minDistance,
      maxDistance,
      PEDESTRIAN_RADIUS,
      seed
    );
    const npc = new NpcState();
    npc.id = id;
    npc.kind = kind;
    npc.x = position.x;
    npc.y = position.y;
    npc.angle = random.unit('npc-spawn-angle', `${id}:${seed}`) * Math.PI * 2;
    npc.health = healthFor(kind);
    state.npcs.set(id, npc);
    this.runtime.set(id, createPedestrianRuntime(
      npc.angle,
      random.range('npc-bravery', id, 0.22, 0.72),
      random.range('npc-perception-offset', id, 0, 220)
    ));
    this.options.onSpawned?.(npc);
    return npc;
  }

  update(npc: NpcState, deltaSeconds: number, nowMs: number): void {
    const runtime = this.runtime.get(npc.id);
    if (!runtime) return;
    if (!npc.alive) {
      this.tryRespawn(npc, runtime, nowMs);
      return;
    }

    const observation = this.perception.observe(npc, runtime, nowMs);
    const intent = this.behavior.decide(npc, runtime, observation, nowMs);
    npc.angle = intent.angle;
    if (!this.locomotion.move(npc, intent.angle, intent.speed, deltaSeconds)) {
      this.navigation.recoverFromBlock(runtime, npc.id, intent.angle, nowMs);
    }
    if (intent.fire) {
      this.options.requestPoliceFire(npc.id, npc.x, npc.y, intent.aimAngle, nowMs);
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
      panicUntil: runtime.panicUntil,
      stimulusKind: runtime.stimulusKind,
      stimulusSourceId: runtime.stimulusSourceId,
      stimulusUntil: runtime.stimulusUntil
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
    if (runtime) runtime.respawnAt = respawnAt;
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
    if (nowMs < runtime.respawnAt) return;
    const position = this.options.world.openPointNear(
      this.options.world.spawn.x,
      this.options.world.spawn.y,
      npc.kind === 'police' ? 420 : 180,
      npc.kind === 'police' ? 900 : 800,
      PEDESTRIAN_RADIUS,
      nowMs + npc.id.length
    );
    npc.x = position.x;
    npc.y = position.y;
    npc.health = healthFor(npc.kind);
    npc.alive = true;
    clearPedestrianThreat(runtime);
    runtime.objective = 'wander';
    runtime.avoidUntil = 0;
    runtime.respawnAt = 0;
  }
}

function healthFor(kind: string): number {
  return kind === 'police' ? 100 : 50;
}
