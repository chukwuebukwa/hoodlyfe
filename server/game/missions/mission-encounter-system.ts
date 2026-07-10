import type {MissionEncounterDefinition} from '../../../shared/content/mission-catalog.ts';
import type {GameEvent} from '../events/game-events.ts';

export interface MissionEncounterParticipant {
  playerId: string;
  connected: boolean;
  alive: boolean;
  x: number;
  y: number;
}

export interface MissionEncounterActorSpawn {
  actorId: string;
  missionId: string;
  centerX: number;
  centerY: number;
  minDistance: number;
  maxDistance: number;
  health: number;
  weapon: 'pistol' | 'smg';
  fireCooldownMs: number;
  seed: number;
}

export interface MissionEncounterSnapshot {
  missionId: string;
  wave: number;
  waveCount: number;
  remaining: number;
  complete: boolean;
  contested: boolean;
  actorIds: string[];
  contributions: Array<{playerId: string; defeats: number}>;
}

interface MissionEncounterSystemOptions {
  spawnActor: (spawn: MissionEncounterActorSpawn) => void;
  actorState: (actorId: string) => {alive: boolean; x: number; y: number} | undefined;
  setActorTarget: (actorId: string, playerId: string) => void;
}

interface MissionEncounterRuntime {
  missionId: string;
  centerX: number;
  centerY: number;
  radius: number;
  definition: MissionEncounterDefinition;
  waveIndex: number;
  pendingSpawns: number;
  nextSpawnAt: number;
  nextWaveAt: number;
  waitingForWave: boolean;
  totalSpawned: number;
  complete: boolean;
  actorIds: Set<string>;
  activeActorIds: Set<string>;
  contributions: Map<string, number>;
}

export class MissionEncounterSystem {
  private readonly encounters = new Map<string, MissionEncounterRuntime>();
  private readonly actorMissions = new Map<string, string>();

  constructor(private readonly options: MissionEncounterSystemOptions) {}

  start(
    missionId: string,
    centerX: number,
    centerY: number,
    radius: number,
    definition: MissionEncounterDefinition,
    nowMs: number
  ): boolean {
    if (this.encounters.has(missionId)) return false;
    if (
      !missionId ||
      !Number.isFinite(centerX) ||
      !Number.isFinite(centerY) ||
      !Number.isFinite(radius) ||
      radius <= 0 ||
      definition.waves.length === 0 ||
      definition.waves.length > 10 ||
      definition.waves.some((wave) => !Number.isInteger(wave.count) || wave.count <= 0)
    ) return false;
    this.encounters.set(missionId, {
      missionId,
      centerX,
      centerY,
      radius,
      definition,
      waveIndex: -1,
      pendingSpawns: 0,
      nextSpawnAt: nowMs,
      nextWaveAt: nowMs,
      waitingForWave: true,
      totalSpawned: 0,
      complete: false,
      actorIds: new Set(),
      activeActorIds: new Set(),
      contributions: new Map()
    });
    return true;
  }

  update(
    missionId: string,
    participants: readonly MissionEncounterParticipant[],
    nowMs: number
  ): MissionEncounterSnapshot | undefined {
    const encounter = this.encounters.get(missionId);
    if (!encounter) return undefined;
    this.pruneDefeatedActors(encounter, nowMs);
    if (!encounter.complete) this.advanceWave(encounter, nowMs);
    if (!encounter.complete) this.spawnNextActor(encounter, nowMs);
    this.assignTargets(encounter, participants);
    return this.snapshot(encounter);
  }

  observeEvents(events: readonly GameEvent[]): void {
    for (const event of events) {
      if (event.type !== 'entity.killed' || event.entityKind !== 'npc') continue;
      const missionId = this.actorMissions.get(event.entityId);
      const encounter = missionId ? this.encounters.get(missionId) : undefined;
      if (!encounter || !encounter.activeActorIds.delete(event.entityId)) continue;
      if (event.attackerId) {
        encounter.contributions.set(
          event.attackerId,
          (encounter.contributions.get(event.attackerId) ?? 0) + 1
        );
      }
      this.finishWaveIfClear(encounter, event.nowMs);
    }
  }

  get(missionId: string): MissionEncounterSnapshot | undefined {
    const encounter = this.encounters.get(missionId);
    return encounter ? this.snapshot(encounter) : undefined;
  }

  remove(missionId: string): string[] {
    const encounter = this.encounters.get(missionId);
    if (!encounter) return [];
    this.encounters.delete(missionId);
    for (const actorId of encounter.actorIds) this.actorMissions.delete(actorId);
    return [...encounter.actorIds].sort();
  }

  clear(): void {
    this.encounters.clear();
    this.actorMissions.clear();
  }

  private advanceWave(encounter: MissionEncounterRuntime, nowMs: number): void {
    if (
      !encounter.waitingForWave ||
      encounter.pendingSpawns > 0 ||
      encounter.activeActorIds.size > 0 ||
      nowMs < encounter.nextWaveAt
    ) return;
    const nextWaveIndex = encounter.waveIndex + 1;
    if (nextWaveIndex >= encounter.definition.waves.length) {
      encounter.complete = true;
      return;
    }
    encounter.waveIndex = nextWaveIndex;
    encounter.pendingSpawns = encounter.definition.waves[nextWaveIndex].count;
    encounter.nextSpawnAt = nowMs;
    encounter.waitingForWave = false;
  }

  private spawnNextActor(encounter: MissionEncounterRuntime, nowMs: number): void {
    if (encounter.pendingSpawns <= 0 || nowMs < encounter.nextSpawnAt) return;
    const wave = encounter.definition.waves[encounter.waveIndex];
    const actorId = `${encounter.missionId}:hostile:${encounter.totalSpawned + 1}`;
    encounter.totalSpawned += 1;
    encounter.pendingSpawns -= 1;
    encounter.nextSpawnAt = nowMs + encounter.definition.spawnCadenceMs;
    encounter.actorIds.add(actorId);
    encounter.activeActorIds.add(actorId);
    this.actorMissions.set(actorId, encounter.missionId);
    this.options.spawnActor({
      actorId,
      missionId: encounter.missionId,
      centerX: encounter.centerX,
      centerY: encounter.centerY,
      minDistance: encounter.definition.spawnMinDistance,
      maxDistance: encounter.definition.spawnMaxDistance,
      health: wave.health,
      weapon: wave.weapon,
      fireCooldownMs: wave.fireCooldownMs,
      seed: encounter.totalSpawned * 101 + encounter.waveIndex * 1_009
    });
  }

  private assignTargets(
    encounter: MissionEncounterRuntime,
    participants: readonly MissionEncounterParticipant[]
  ): void {
    const available = participants.filter((participant) => participant.connected && participant.alive);
    for (const actorId of encounter.activeActorIds) {
      const actor = this.options.actorState(actorId);
      if (!actor?.alive || available.length === 0) {
        this.options.setActorTarget(actorId, '');
        continue;
      }
      const target = available.slice().sort((left, right) => (
        Math.hypot(left.x - actor.x, left.y - actor.y) -
        Math.hypot(right.x - actor.x, right.y - actor.y) ||
        left.playerId.localeCompare(right.playerId)
      ))[0];
      this.options.setActorTarget(actorId, target.playerId);
    }
  }

  private pruneDefeatedActors(encounter: MissionEncounterRuntime, nowMs: number): void {
    let removed = false;
    for (const actorId of encounter.activeActorIds) {
      if (this.options.actorState(actorId)?.alive) continue;
      encounter.activeActorIds.delete(actorId);
      removed = true;
    }
    if (removed) this.finishWaveIfClear(encounter, nowMs);
  }

  private finishWaveIfClear(encounter: MissionEncounterRuntime, nowMs: number): void {
    if (encounter.pendingSpawns > 0 || encounter.activeActorIds.size > 0) return;
    if (encounter.waveIndex >= encounter.definition.waves.length - 1) {
      encounter.complete = true;
      encounter.waitingForWave = false;
      return;
    }
    encounter.waitingForWave = true;
    encounter.nextWaveAt = nowMs + encounter.definition.interWaveDelayMs;
  }

  private snapshot(encounter: MissionEncounterRuntime): MissionEncounterSnapshot {
    const contested = [...encounter.activeActorIds].some((actorId) => {
      const actor = this.options.actorState(actorId);
      return Boolean(actor?.alive && Math.hypot(
        actor.x - encounter.centerX,
        actor.y - encounter.centerY
      ) <= encounter.radius);
    });
    return {
      missionId: encounter.missionId,
      wave: encounter.waveIndex + 1,
      waveCount: encounter.definition.waves.length,
      remaining: encounter.activeActorIds.size + encounter.pendingSpawns,
      complete: encounter.complete,
      contested,
      actorIds: [...encounter.actorIds].sort(),
      contributions: [...encounter.contributions.entries()]
        .map(([playerId, defeats]) => ({playerId, defeats}))
        .sort((left, right) => left.playerId.localeCompare(right.playerId))
    };
  }
}
