import type {PursuitRecord} from '../police/pursuit-memory.ts';
import type {DeterministicRandom} from '../world/deterministic-random.ts';
import {NpcState, type DistrictState, type PlayerState, type VehicleState} from '../../state.ts';
import type {CollisionMap} from '../../world-map.ts';

export const PEDESTRIAN_RADIUS = 10;

const POLICE_FIRE_COOLDOWN_MS = 680;

interface PedestrianRuntime {
  wanderAngle: number;
  nextThinkAt: number;
  lastShotAt: number;
  panicUntil: number;
  threatId: string;
  respawnAt: number;
}

export interface PedestrianPoliceTarget {
  pursuit?: PursuitRecord;
  canSeeTarget: boolean;
  targetDistance: number;
}

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
  private nextEjectedDriverId = 1;

  constructor(private readonly options: PedestrianControllerOptions) {}

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
    this.runtime.set(id, createRuntime(npc.angle));
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

    if (npc.kind === 'police' && this.updatePolice(npc, runtime, deltaSeconds, nowMs)) {
      return;
    }

    if (runtime.panicUntil > nowMs) {
      const threat = this.options.state.players.get(runtime.threatId);
      if (threat) runtime.wanderAngle = angleAwayFrom(npc, threat);
    } else if (nowMs >= runtime.nextThinkAt) {
      const key = `${npc.id}:${this.options.clock().tick}`;
      runtime.wanderAngle += (
        this.options.random.unit('npc-wander-turn', key) - 0.5
      ) * Math.PI * 1.6;
      runtime.nextThinkAt = nowMs + this.options.random.range(
        'npc-think-delay',
        key,
        1200,
        3800
      );
    }

    const speed = runtime.panicUntil > nowMs ? 175 : (npc.kind === 'police' ? 78 : 62);
    npc.angle = runtime.wanderAngle;
    if (this.move(npc, runtime.wanderAngle, speed, deltaSeconds)) return;
    runtime.wanderAngle = normalizeAngle(
      runtime.wanderAngle + Math.PI * this.options.random.range(
        'npc-collision-turn',
        `${npc.id}:${this.options.clock().tick}`,
        0.55,
        1.55
      )
    );
    runtime.nextThinkAt = nowMs + 250;
  }

  panic(npcId: string, threatId: string, untilMs: number): void {
    const runtime = this.runtime.get(npcId);
    if (!runtime) return;
    runtime.panicUntil = Math.max(runtime.panicUntil, untilMs);
    runtime.threatId = threatId;
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
      ...createRuntime(npc.angle),
      nextThinkAt: nowMs + 1100,
      panicUntil: nowMs + 4500,
      threatId: hijacker.id
    });
    this.options.onSpawned?.(npc);
    return id;
  }

  private updatePolice(
    npc: NpcState,
    runtime: PedestrianRuntime,
    deltaSeconds: number,
    nowMs: number
  ): boolean {
    const response = this.options.policeTarget(npc, nowMs);
    if (!response?.pursuit) return false;
    const {pursuit, canSeeTarget, targetDistance} = response;
    const angle = Math.atan2(pursuit.lastKnownY - npc.y, pursuit.lastKnownX - npc.x);
    const distance = Math.hypot(pursuit.lastKnownX - npc.x, pursuit.lastKnownY - npc.y);
    npc.angle = angle;
    if (distance > (pursuit.mode === 'pursuit' ? 165 : 28)) {
      this.move(npc, angle, pursuit.mode === 'pursuit' ? 158 : 132, deltaSeconds);
    }
    if (
      canSeeTarget &&
      targetDistance < 430 &&
      nowMs - runtime.lastShotAt >= POLICE_FIRE_COOLDOWN_MS
    ) {
      runtime.lastShotAt = nowMs;
      this.options.requestPoliceFire(npc.id, npc.x, npc.y, angle, nowMs);
    }
    return true;
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
    runtime.panicUntil = 0;
    runtime.threatId = '';
    runtime.respawnAt = 0;
  }

  private move(npc: NpcState, angle: number, speed: number, deltaSeconds: number): boolean {
    const nextX = npc.x + Math.cos(angle) * speed * deltaSeconds;
    const nextY = npc.y + Math.sin(angle) * speed * deltaSeconds;
    let moved = false;
    if (this.options.world.canOccupy(nextX, npc.y, PEDESTRIAN_RADIUS)) {
      npc.x = nextX;
      moved = true;
    }
    if (this.options.world.canOccupy(npc.x, nextY, PEDESTRIAN_RADIUS)) {
      npc.y = nextY;
      moved = true;
    }
    return moved;
  }
}

function createRuntime(wanderAngle: number): PedestrianRuntime {
  return {
    wanderAngle,
    nextThinkAt: 0,
    lastShotAt: 0,
    panicUntil: 0,
    threatId: '',
    respawnAt: 0
  };
}

function healthFor(kind: string): number {
  return kind === 'police' ? 100 : 50;
}

function angleAwayFrom(npc: NpcState, threat: PlayerState): number {
  return Math.atan2(npc.y - threat.y, npc.x - threat.x);
}

function normalizeAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}
