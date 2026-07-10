import {type Client, Room} from '@colyseus/core';
import {
  DEBUG_SNAPSHOT_MESSAGE,
  type DebugEventEntry,
  type DebugSnapshot
} from '../shared/protocol/debug.ts';
import {
  MISSION_ABANDON_MESSAGE,
  MISSION_JOIN_MESSAGE,
  MISSION_LAUNCH_MESSAGE,
  MISSION_NOTICE_MESSAGE,
  MISSION_START_MESSAGE,
  type MissionIdMessage,
  type MissionNotice
} from '../shared/protocol/missions.ts';
import {
  GameEventStream,
  type GameEvent
} from './game/events/game-events.ts';
import {FreemodeMissionController} from './game/missions/freemode-mission-controller.ts';
import {CrimeResponseController} from './game/police/crime-response-controller.ts';
import {TrafficController} from './game/traffic/traffic-controller.ts';
import {DamageController} from './game/combat/damage-controller.ts';
import {FireControlController} from './game/combat/fire-control-controller.ts';
import {ProjectileController} from './game/combat/projectile-controller.ts';
import {PlayerLifecycleController} from './game/players/player-lifecycle-controller.ts';
import {vehicleConfig} from './game/vehicles/vehicle-config.ts';
import {VehicleAccessController} from './game/vehicles/vehicle-access-controller.ts';
import {VehicleSimulationController} from './game/vehicles/vehicle-simulation-controller.ts';
import {DeferredCommandQueue} from './game/world/deferred-command-queue.ts';
import {DeterministicRandom} from './game/world/deterministic-random.ts';
import {FixedStepClock} from './game/world/fixed-step-clock.ts';
import {SpatialIndex, type SpatialRecord} from './game/world/spatial-index.ts';
import {DistrictState, NpcState, PlayerState, VehicleState} from './state.ts';
import {CollisionMap} from './world-map.ts';

const PLAYER_RADIUS = 11;
const PLAYER_SPEED = 190;
const NPC_RADIUS = 10;
const VEHICLE_RADIUS = 20;
const POLICE_FIRE_COOLDOWN_MS = 680;
const TRAFFIC_VEHICLE_COUNT = 8;

interface InputMessage {
  x?: number;
  y?: number;
}

interface AimMessage {
  angle?: number;
}

interface CycleWeaponMessage {
  direction?: number;
}

interface DistrictRoomOptions {
  seed?: number;
}

type WorldEntityKind = 'player' | 'npc' | 'vehicle';

interface RuntimePlayer {
  inputX: number;
  inputY: number;
}

interface RuntimeNpc {
  wanderAngle: number;
  nextThinkAt: number;
  lastShotAt: number;
  panicUntil: number;
  threatId: string;
  respawnAt: number;
}

export class DistrictRoom extends Room<DistrictState> {
  maxClients = 32;
  autoDispose = false;
  patchRate = 50;

  private readonly runtimePlayers = new Map<string, RuntimePlayer>();
  private readonly runtimeNpcs = new Map<string, RuntimeNpc>();
  private readonly simulationClock = new FixedStepClock();
  private readonly spatialIndex = new SpatialIndex<WorldEntityKind>();
  private readonly lifecycle = new DeferredCommandQueue();
  private readonly events = new GameEventStream();
  private missionController!: FreemodeMissionController;
  private crimeController!: CrimeResponseController;
  private vehicleAccess!: VehicleAccessController;
  private trafficController!: TrafficController;
  private vehicleSimulation!: VehicleSimulationController;
  private playerLifecycle!: PlayerLifecycleController;
  private damageController!: DamageController;
  private fireControl!: FireControlController;
  private projectileController!: ProjectileController;
  private readonly debugEnabled = process.env.GAME_DEBUG === '1' || process.env.NODE_ENV !== 'production';
  private readonly recentDebugEvents: DebugEventEntry[] = [];
  private random = new DeterministicRandom('industrial-district:v1');
  private lastTickEvents: GameEvent[] = [];
  private lastDebugBroadcastTick = 0;
  private world!: CollisionMap;
  private nextEjectedDriverId = 1;

  onCreate(options?: DistrictRoomOptions): void {
    this.simulationClock.reset();
    this.lifecycle.clear();
    this.events.clear();
    this.recentDebugEvents.length = 0;
    this.lastDebugBroadcastTick = 0;
    const requestedSeed = Number(options?.seed);
    this.random = new DeterministicRandom(
      Number.isFinite(requestedSeed) ? requestedSeed : 'industrial-district:v1'
    );
    this.world = CollisionMap.load();
    this.setState(new DistrictState());
    this.state.missionContactX = this.world.spawn.x;
    this.state.missionContactY = this.world.spawn.y;
    this.trafficController = new TrafficController({
      world: this.world,
      random: this.random
    });
    this.crimeController = new CrimeResponseController({
      state: this.state,
      world: this.world,
      events: this.events,
      clock: () => ({tick: this.simulationClock.tick, nowMs: this.simulationClock.nowMs}),
      queryNpcs: (x, y, radius) => this.spatialIndex.queryCircle(x, y, radius, {kinds: ['npc']})
        .map((record) => this.state.npcs.get(record.id))
        .filter((npc): npc is NpcState => Boolean(npc)),
      panicWitness: (witnessId, suspectId, untilMs) => {
        const runtime = this.runtimeNpcs.get(witnessId);
        if (!runtime) return;
        runtime.panicUntil = Math.max(runtime.panicUntil, untilMs);
        runtime.threatId = suspectId;
      }
    });
    this.vehicleAccess = new VehicleAccessController({
      state: this.state,
      world: this.world,
      nearbyVehicles: (x, y, radius) => this.spatialIndex.queryCircle(x, y, radius, {
        kinds: ['vehicle']
      }).map((record) => this.state.vehicles.get(record.id))
        .filter((vehicle): vehicle is VehicleState => Boolean(vehicle)),
      createEjectedDriver: (vehicle, hijacker, nowMs) => this.spawnEjectedDriver(
        vehicle,
        hijacker,
        nowMs
      ),
      recordTheft: (playerId, victimId, x, y, nowMs) => this.crimeController.record(
        playerId,
        'vehicle-theft',
        nowMs,
        victimId,
        x,
        y
      ),
      releaseTrafficControl: (vehicleId) => this.trafficController.release(vehicleId)
    });
    this.playerLifecycle = new PlayerLifecycleController({
      state: this.state,
      world: this.world,
      events: this.events,
      access: this.vehicleAccess,
      crime: this.crimeController,
      clock: () => ({tick: this.simulationClock.tick}),
      resetInput: (playerId) => {
        const input = this.runtimePlayers.get(playerId);
        if (!input) return;
        input.inputX = 0;
        input.inputY = 0;
      }
    });
    this.damageController = new DamageController({
      state: this.state,
      events: this.events,
      crime: this.crimeController,
      playerLifecycle: this.playerLifecycle,
      clock: () => ({tick: this.simulationClock.tick}),
      panicNpc: (npcId, attackerId, untilMs) => {
        const runtime = this.runtimeNpcs.get(npcId);
        if (!runtime) return;
        runtime.panicUntil = untilMs;
        runtime.threatId = attackerId;
      },
      scheduleNpcRespawn: (npcId, respawnAt) => {
        const runtime = this.runtimeNpcs.get(npcId);
        if (runtime) runtime.respawnAt = respawnAt;
      }
    });
    const nearbyPlayers = (x: number, y: number, radius: number) => this.spatialIndex.queryCircle(
      x,
      y,
      radius,
      {kinds: ['player'], includeRecordRadius: true}
    ).map((record) => this.state.players.get(record.id))
      .filter((player): player is PlayerState => Boolean(player));
    const nearbyNpcs = (x: number, y: number, radius: number) => this.spatialIndex.queryCircle(
      x,
      y,
      radius,
      {kinds: ['npc'], includeRecordRadius: true}
    ).map((record) => this.state.npcs.get(record.id))
      .filter((npc): npc is NpcState => Boolean(npc));
    this.vehicleSimulation = new VehicleSimulationController({
      state: this.state,
      world: this.world,
      events: this.events,
      access: this.vehicleAccess,
      traffic: this.trafficController,
      clock: () => ({tick: this.simulationClock.tick}),
      inputFor: (playerId) => this.runtimePlayers.get(playerId),
      nearbyPlayers,
      nearbyNpcs,
      nearbyVehicles: (x, y, radius) => this.spatialIndex.queryCircle(x, y, radius, {
        kinds: ['vehicle'],
        includeRecordRadius: true
      }).map((record) => this.state.vehicles.get(record.id))
        .filter((vehicle): vehicle is VehicleState => Boolean(vehicle)),
      damagePlayer: (player, damage, attackerId, nowMs, crimeKind) => this.damageController.player(
        player,
        damage,
        attackerId,
        nowMs,
        crimeKind
      ),
      damageNpc: (npc, damage, attackerId, nowMs, crimeKind) => this.damageController.npc(
        npc,
        damage,
        attackerId,
        nowMs,
        crimeKind
      )
    });
    this.fireControl = new FireControlController({
      state: this.state,
      random: this.random,
      clock: () => ({tick: this.simulationClock.tick, nowMs: this.simulationClock.nowMs})
    });
    this.projectileController = new ProjectileController({
      state: this.state,
      world: this.world,
      access: this.vehicleAccess,
      vehicles: this.vehicleSimulation,
      damage: this.damageController,
      queryPlayers: (minX, minY, maxX, maxY) => this.spatialIndex.queryAabb(
        minX,
        minY,
        maxX,
        maxY,
        {kinds: ['player']}
      ).map((record) => this.state.players.get(record.id))
        .filter((player): player is PlayerState => Boolean(player)),
      queryNpcs: (minX, minY, maxX, maxY) => this.spatialIndex.queryAabb(
        minX,
        minY,
        maxX,
        maxY,
        {kinds: ['npc']}
      ).map((record) => this.state.npcs.get(record.id))
        .filter((npc): npc is NpcState => Boolean(npc)),
      queryVehicles: (minX, minY, maxX, maxY) => this.spatialIndex.queryAabb(
        minX,
        minY,
        maxX,
        maxY,
        {kinds: ['vehicle']}
      ).map((record) => this.state.vehicles.get(record.id))
        .filter((vehicle): vehicle is VehicleState => Boolean(vehicle)),
      remove: (bulletId) => this.lifecycle.defer(`bullet.remove:${bulletId}`, () => {
        this.state.bullets.delete(bulletId);
      })
    });
    this.missionController = new FreemodeMissionController({
      state: this.state,
      world: this.world,
      events: this.events,
      clock: () => ({tick: this.simulationClock.tick, nowMs: this.simulationClock.nowMs}),
      notice: (playerId, message, tone) => this.noticePlayer(playerId, message, tone),
      releaseDeliveredVehicle: (vehicle, nowMs) => this.vehicleSimulation.returnToTraffic(
        vehicle,
        nowMs
      )
    });
    this.spawnDistrictPopulation();
    this.rebuildSpatialIndex();
    this.setSimulationInterval((deltaTime) => this.advanceSimulation(deltaTime), 1000 / 30);

    this.onMessage<InputMessage>('input', (client, message) => {
      const runtime = this.runtimePlayers.get(client.sessionId);
      if (!runtime) return;
      const x = Number(message?.x);
      const y = Number(message?.y);
      runtime.inputX = Number.isFinite(x) ? clamp(x, -1, 1) : 0;
      runtime.inputY = Number.isFinite(y) ? clamp(y, -1, 1) : 0;
    });

    this.onMessage<AimMessage>('aim', (client, message) => {
      const player = this.state.players.get(client.sessionId);
      const angle = Number(message?.angle);
      const canAim = player && (!player.vehicleId || player.vehicleSeat > 0);
      if (player?.alive && canAim && !player.action && Number.isFinite(angle)) {
        player.angle = normalizeAngle(angle);
      }
    });

    this.onMessage('shoot', (client) => this.fireControl.shoot(client.sessionId));
    this.onMessage<CycleWeaponMessage>('cycleWeapon', (client, message) => {
      this.fireControl.cycle(client.sessionId, message?.direction);
    });
    this.onMessage('interact', (client) => {
      this.vehicleAccess.interact(client.sessionId, this.simulationClock.nowMs);
    });
    this.onMessage(MISSION_START_MESSAGE, (client) => this.missionController.start(client.sessionId));
    this.onMessage<MissionIdMessage>(MISSION_JOIN_MESSAGE, (client, message) => {
      this.missionController.join(client.sessionId, message?.missionId);
    });
    this.onMessage<MissionIdMessage>(MISSION_LAUNCH_MESSAGE, (client, message) => {
      this.missionController.launch(client.sessionId, message?.missionId);
    });
    this.onMessage<MissionIdMessage>(MISSION_ABANDON_MESSAGE, (client, message) => {
      this.missionController.abandon(client.sessionId, message?.missionId);
    });
  }

  onJoin(client: Client, options: {name?: string}): void {
    const spawn = this.world.spawnFor(this.state.players.size, PLAYER_RADIUS);
    const player = new PlayerState();
    player.id = client.sessionId;
    player.name = sanitizeName(options?.name, this.state.players.size + 1);
    player.x = spawn.x;
    player.y = spawn.y;
    player.angle = -Math.PI / 2;
    this.state.players.set(client.sessionId, player);
    this.runtimePlayers.set(client.sessionId, {
      inputX: 0,
      inputY: 0
    });
    this.indexPlayer(player);
  }

  onLeave(client: Client): void {
    const player = this.state.players.get(client.sessionId);
    if (player) this.vehicleAccess.removePlayer(player);
    this.state.players.delete(client.sessionId);
    this.runtimePlayers.delete(client.sessionId);
    this.fireControl.clearPlayer(client.sessionId);
    this.crimeController.clearSuspect(client.sessionId);
    this.spatialIndex.remove('player', client.sessionId);
  }

  private noticePlayer(
    playerId: string,
    message: string,
    tone: MissionNotice['tone']
  ): void {
    const client = this.clients.find((candidate) => candidate.sessionId === playerId);
    client?.send(MISSION_NOTICE_MESSAGE, {message, tone} satisfies MissionNotice);
  }

  private spawnDistrictPopulation(): void {
    for (let index = 0; index < 10; index++) {
      this.spawnNpc(`civilian-${index + 1}`, 'civilian', index, 130, 760);
    }
    for (let index = 0; index < 3; index++) {
      this.spawnNpc(`police-${index + 1}`, 'police', index + 30, 420, 900);
    }

    const kinds = ['sedan', 'police', 'taxi'];
    for (let index = 0; index < kinds.length; index++) {
      let starterAngle = Math.PI;
      let position: {x: number; y: number} | undefined;
      if (index === 0) {
        const starterOffsets = [[52, 0], [-52, 0], [0, 52], [0, -52]];
        for (const [offsetX, offsetY] of starterOffsets) {
          const candidate = {x: this.world.spawn.x + offsetX, y: this.world.spawn.y + offsetY};
          if (!this.world.canOccupy(candidate.x, candidate.y, VEHICLE_RADIUS)) continue;
          position = candidate;
          starterAngle = Math.atan2(offsetY, offsetX);
          break;
        }
        position ??= {...this.world.spawn};
      } else {
        position = this.world.openPointNear(
          this.world.spawn.x,
          this.world.spawn.y,
          180 + index * 80,
          420 + index * 120,
          VEHICLE_RADIUS,
          70 + index
        );
      }
      const vehicle = new VehicleState();
      vehicle.id = `vehicle-${index + 1}`;
      vehicle.kind = kinds[index];
      vehicle.x = position.x;
      vehicle.y = position.y;
      vehicle.angle = index === 0 ? starterAngle : (index % 2 === 0 ? -Math.PI / 2 : 0);
      vehicle.maxHealth = vehicleConfig(vehicle.kind).maxHealth;
      vehicle.health = vehicle.maxHealth;
      this.state.vehicles.set(vehicle.id, vehicle);
    }

    for (let index = 0; index < TRAFFIC_VEHICLE_COUNT; index++) {
      const spawn = this.world.trafficSpawn(200 + index * 19, VEHICLE_RADIUS);
      const vehicle = new VehicleState();
      vehicle.id = `traffic-${index + 1}`;
      vehicle.kind = index % 4 === 2 ? 'taxi' : 'sedan';
      vehicle.x = spawn.x;
      vehicle.y = spawn.y;
      vehicle.angle = spawn.angle;
      vehicle.speed = 90 + index * 4;
      vehicle.maxHealth = vehicleConfig(vehicle.kind).maxHealth;
      vehicle.health = vehicle.maxHealth;
      vehicle.traffic = true;
      this.state.vehicles.set(vehicle.id, vehicle);
      this.trafficController.register(vehicle.id, spawn, 105 + (index % 4) * 14);
    }
  }

  private spawnNpc(
    id: string,
    kind: 'civilian' | 'police',
    seed: number,
    minDistance: number,
    maxDistance: number
  ): void {
    const position = this.world.openPointNear(
      this.world.spawn.x,
      this.world.spawn.y,
      minDistance,
      maxDistance,
      NPC_RADIUS,
      seed
    );
    const npc = new NpcState();
    npc.id = id;
    npc.kind = kind;
    npc.x = position.x;
    npc.y = position.y;
    npc.angle = this.random.unit('npc-spawn-angle', `${id}:${seed}`) * Math.PI * 2;
    npc.health = kind === 'police' ? 100 : 50;
    this.state.npcs.set(id, npc);
    this.runtimeNpcs.set(id, {
      wanderAngle: npc.angle,
      nextThinkAt: 0,
      lastShotAt: 0,
      panicUntil: 0,
      threatId: '',
      respawnAt: 0
    });
  }

  private advanceSimulation(deltaTime: number): void {
    this.simulationClock.advance(deltaTime, (frame) => {
      this.updateFixedStep(frame.deltaSeconds, frame.nowMs);
    });
    this.lastTickEvents = this.events.drain();
    this.captureDebugEvents(this.lastTickEvents);
    this.broadcastDebugSnapshot();
  }

  private updateFixedStep(deltaSeconds: number, now: number): void {
    this.vehicleSimulation.beginTick();
    this.state.vehicles.forEach((vehicle) => {
      this.vehicleSimulation.update(vehicle, deltaSeconds, now);
      this.indexVehicle(vehicle);
    });
    this.state.players.forEach((player, playerId) => {
      const runtime = this.runtimePlayers.get(playerId);
      if (!runtime) return;
      if (!player.alive) {
        this.playerLifecycle.tryRespawn(player, now);
      } else if (player.action) {
        this.vehicleAccess.updateAction(player, now);
      } else {
        if (!player.vehicleId) this.movePlayer(player, runtime, deltaSeconds);
        this.crimeController.decay(player, now);
      }
      this.indexPlayer(player);
    });
    this.crimeController.processReports(now);
    this.crimeController.updateDispatch(now);
    this.state.npcs.forEach((npc) => {
      this.updateNpc(npc, deltaSeconds, now);
      this.indexNpc(npc);
    });
    this.state.bullets.forEach((bullet, bulletId) => {
      this.projectileController.update(bullet, bulletId, deltaSeconds, now);
    });
    this.crimeController.expire(now);
    this.missionController.update(now);
    this.lifecycle.flush();
  }

  private movePlayer(player: PlayerState, runtime: RuntimePlayer, deltaSeconds: number): void {
    const magnitude = Math.hypot(runtime.inputX, runtime.inputY);
    if (magnitude === 0) return;
    const distance = PLAYER_SPEED * deltaSeconds;
    const moveX = runtime.inputX / magnitude * distance;
    const moveY = runtime.inputY / magnitude * distance;
    const nextX = player.x + moveX;
    if (this.world.canOccupy(nextX, player.y, PLAYER_RADIUS)) player.x = nextX;
    const nextY = player.y + moveY;
    if (this.world.canOccupy(player.x, nextY, PLAYER_RADIUS)) player.y = nextY;
  }

  private updateNpc(npc: NpcState, deltaSeconds: number, now: number): void {
    const runtime = this.runtimeNpcs.get(npc.id);
    if (!runtime) return;
    if (!npc.alive) {
      if (now >= runtime.respawnAt) {
        const position = this.world.openPointNear(
          this.world.spawn.x,
          this.world.spawn.y,
          npc.kind === 'police' ? 420 : 180,
          npc.kind === 'police' ? 900 : 800,
          NPC_RADIUS,
          now + npc.id.length
        );
        npc.x = position.x;
        npc.y = position.y;
        npc.health = npc.kind === 'police' ? 100 : 50;
        npc.alive = true;
      }
      return;
    }

    if (npc.kind === 'police') {
      const response = this.crimeController.policeTarget(npc, now);
      if (response) {
        const {player: target, pursuit, canSeeTarget, targetDistance} = response;
        if (!pursuit) {
          // An assigned officer without a sighting patrols until the suspect re-enters view.
        } else {
          const angle = Math.atan2(pursuit.lastKnownY - npc.y, pursuit.lastKnownX - npc.x);
          const distance = Math.hypot(pursuit.lastKnownX - npc.x, pursuit.lastKnownY - npc.y);
          npc.angle = angle;
          if (distance > (pursuit.mode === 'pursuit' ? 165 : 28)) {
            this.moveNpc(npc, angle, pursuit.mode === 'pursuit' ? 158 : 132, deltaSeconds);
          }
          if (
            canSeeTarget &&
            targetDistance < 430 &&
            now - runtime.lastShotAt >= POLICE_FIRE_COOLDOWN_MS
          ) {
            runtime.lastShotAt = now;
            this.fireControl.createNpcBullet(npc.id, npc.x, npc.y, angle, now, 'pistol');
          }
          return;
        }
      }
    }

    if (runtime.panicUntil > now) {
      const threat = this.state.players.get(runtime.threatId);
      if (threat) {
        runtime.wanderAngle = Math.atan2(npc.y - threat.y, npc.x - threat.x);
      }
    } else if (now >= runtime.nextThinkAt) {
      const key = `${npc.id}:${this.simulationClock.tick}`;
      runtime.wanderAngle += (this.random.unit('npc-wander-turn', key) - 0.5) * Math.PI * 1.6;
      runtime.nextThinkAt = now + this.random.range('npc-think-delay', key, 1200, 3800);
    }

    const speed = runtime.panicUntil > now ? 175 : (npc.kind === 'police' ? 78 : 62);
    npc.angle = runtime.wanderAngle;
    if (!this.moveNpc(npc, runtime.wanderAngle, speed, deltaSeconds)) {
      runtime.wanderAngle = normalizeAngle(
        runtime.wanderAngle + Math.PI * this.random.range(
          'npc-collision-turn',
          `${npc.id}:${this.simulationClock.tick}`,
          0.55,
          1.55
        )
      );
      runtime.nextThinkAt = now + 250;
    }
  }

  private moveNpc(npc: NpcState, angle: number, speed: number, deltaSeconds: number): boolean {
    const nextX = npc.x + Math.cos(angle) * speed * deltaSeconds;
    const nextY = npc.y + Math.sin(angle) * speed * deltaSeconds;
    let moved = false;
    if (this.world.canOccupy(nextX, npc.y, NPC_RADIUS)) {
      npc.x = nextX;
      moved = true;
    }
    if (this.world.canOccupy(npc.x, nextY, NPC_RADIUS)) {
      npc.y = nextY;
      moved = true;
    }
    return moved;
  }

  private spawnEjectedDriver(vehicle: VehicleState, hijacker: PlayerState, now: number): string {
    const id = `ejected-driver-${this.nextEjectedDriverId++}`;
    const sideAngle = vehicle.angle - Math.PI / 2;
    const preferredX = vehicle.x + Math.cos(sideAngle) * 48;
    const preferredY = vehicle.y + Math.sin(sideAngle) * 48;
    const position = this.world.canOccupy(preferredX, preferredY, NPC_RADIUS)
      ? {x: preferredX, y: preferredY}
      : this.world.openPointNear(vehicle.x, vehicle.y, 38, 86, NPC_RADIUS, now);
    const npc = new NpcState();
    npc.id = id;
    npc.kind = 'civilian';
    npc.x = position.x;
    npc.y = position.y;
    npc.angle = Math.atan2(position.y - vehicle.y, position.x - vehicle.x);
    this.state.npcs.set(id, npc);
    this.runtimeNpcs.set(id, {
      wanderAngle: npc.angle,
      nextThinkAt: now + 1100,
      lastShotAt: 0,
      panicUntil: now + 4500,
      threatId: hijacker.id,
      respawnAt: 0
    });
    this.indexNpc(npc);
    return id;
  }

  private rebuildSpatialIndex(): void {
    const records: Array<SpatialRecord<WorldEntityKind>> = [];
    for (const player of this.state.players.values()) {
      records.push(this.playerSpatialRecord(player));
    }
    for (const npc of this.state.npcs.values()) {
      records.push(this.npcSpatialRecord(npc));
    }
    for (const vehicle of this.state.vehicles.values()) {
      records.push(this.vehicleSpatialRecord(vehicle));
    }
    this.spatialIndex.rebuild(records);
  }

  private indexPlayer(player: PlayerState): void {
    this.spatialIndex.upsert(this.playerSpatialRecord(player));
  }

  private indexNpc(npc: NpcState): void {
    this.spatialIndex.upsert(this.npcSpatialRecord(npc));
  }

  private indexVehicle(vehicle: VehicleState): void {
    this.spatialIndex.upsert(this.vehicleSpatialRecord(vehicle));
  }

  private playerSpatialRecord(player: PlayerState): SpatialRecord<WorldEntityKind> {
    return {id: player.id, kind: 'player', x: player.x, y: player.y, radius: PLAYER_RADIUS};
  }

  private npcSpatialRecord(npc: NpcState): SpatialRecord<WorldEntityKind> {
    return {id: npc.id, kind: 'npc', x: npc.x, y: npc.y, radius: NPC_RADIUS};
  }

  private vehicleSpatialRecord(vehicle: VehicleState): SpatialRecord<WorldEntityKind> {
    return {id: vehicle.id, kind: 'vehicle', x: vehicle.x, y: vehicle.y, radius: VEHICLE_RADIUS};
  }

  private captureDebugEvents(events: readonly GameEvent[]): void {
    if (!this.debugEnabled) return;
    for (const event of events) {
      this.recentDebugEvents.push({
        tick: event.tick,
        type: event.type,
        summary: summarizeGameEvent(event)
      });
    }
    if (this.recentDebugEvents.length > 8) {
      this.recentDebugEvents.splice(0, this.recentDebugEvents.length - 8);
    }
  }

  private broadcastDebugSnapshot(): void {
    if (!this.debugEnabled || this.simulationClock.tick - this.lastDebugBroadcastTick < 6) return;
    this.lastDebugBroadcastTick = this.simulationClock.tick;
    const snapshot: DebugSnapshot = {
      tick: this.simulationClock.tick,
      nowMs: this.simulationClock.nowMs,
      droppedMs: this.simulationClock.droppedMs,
      spatialEntities: this.spatialIndex.size,
      deferredCommands: this.lifecycle.size,
      eventsThisTick: this.lastTickEvents.length,
      players: this.state.players.size,
      npcs: this.state.npcs.size,
      vehicles: this.state.vehicles.size,
      bullets: this.state.bullets.size,
      incidents: this.crimeController.incidentSnapshot().map((incident) => ({
        id: incident.id,
        kind: incident.kind,
        suspectId: incident.suspectId,
        witnessId: incident.witnessId,
        status: incident.status,
        x: incident.x,
        y: incident.y
      })),
      pursuits: this.crimeController.pursuitSnapshot().map((pursuit) => ({
        officerId: pursuit.officerId,
        suspectId: pursuit.suspectId,
        lastKnownX: pursuit.lastKnownX,
        lastKnownY: pursuit.lastKnownY,
        mode: pursuit.mode
      })),
      events: [...this.recentDebugEvents]
    };
    this.broadcast(DEBUG_SNAPSHOT_MESSAGE, snapshot);
  }
}

function summarizeGameEvent(event: GameEvent): string {
  switch (event.type) {
    case 'damage.applied':
      return `${event.attackerId || 'world'} -> ${event.targetKind}:${event.targetId} -${event.amount}`;
    case 'entity.killed':
      return `${event.entityKind}:${event.entityId} killed by ${event.attackerId || 'world'}`;
    case 'crime.committed':
      return `${event.suspectId} committed ${event.crimeKind} (${event.incidentId})`;
    case 'incident.reported':
      return `${event.witnessId} reported ${event.suspectId} => heat ${event.wantedLevel}`;
    case 'pursuit.changed':
      return event.suspectId
        ? `${event.officerId} dispatched to ${event.suspectId}`
        : `${event.officerId} cleared from ${event.previousSuspectId}`;
    case 'vehicle.damaged':
      return `${event.vehicleId} -${event.amount} hp (${event.sourceKind})`;
    case 'vehicle.ignited':
      return `${event.vehicleId} ignited; explosion fuse armed`;
    case 'vehicle.destroyed':
      return `${event.vehicleId} destroyed by ${event.sourceId || event.sourceKind}`;
    case 'vehicle.restored':
      return `${event.vehicleId} restored to ${event.health} hp`;
    case 'player.respawned':
      return `${event.playerId} respawned`;
    case 'mission.phase-changed':
      return `${event.missionId} ${event.previousPhase} -> ${event.phase}`;
    case 'mission.payout':
      return `${event.missionId} paid ${event.playerId} $${event.amount}`;
    case 'mission.failed':
      return `${event.missionId} failed: ${event.reason}`;
  }
}

function sanitizeName(value: unknown, fallbackNumber: number): string {
  const name = String(value ?? '').replace(/[^a-zA-Z0-9 _-]/g, '').trim().slice(0, 18);
  return name || `Driver ${fallbackNumber}`;
}

function normalizeAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
