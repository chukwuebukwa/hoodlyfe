import {type Client, Room} from '@colyseus/core';
import {
  DEBUG_SUBSCRIBE_MESSAGE,
  DEBUG_UNSUBSCRIBE_MESSAGE
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
import {DebugSnapshotController} from './game/debug/debug-snapshot-controller.ts';
import {GameEventStream} from './game/events/game-events.ts';
import {FreemodeMissionController} from './game/missions/freemode-mission-controller.ts';
import {CrimeResponseController} from './game/police/crime-response-controller.ts';
import {DistrictPopulationController} from './game/population/district-population-controller.ts';
import {TrafficController} from './game/traffic/traffic-controller.ts';
import {DamageController} from './game/combat/damage-controller.ts';
import {FireControlController} from './game/combat/fire-control-controller.ts';
import {ProjectileController} from './game/combat/projectile-controller.ts';
import {
  PlayerControlController,
  PLAYER_RADIUS,
  type PlayerAimInput,
  type PlayerMoveInput
} from './game/players/player-control-controller.ts';
import {PlayerLifecycleController} from './game/players/player-lifecycle-controller.ts';
import {
  PedestrianController,
  PEDESTRIAN_RADIUS
} from './game/pedestrians/pedestrian-controller.ts';
import {VEHICLE_RADIUS} from './game/vehicles/vehicle-config.ts';
import {VehicleAccessController} from './game/vehicles/vehicle-access-controller.ts';
import {VehicleSimulationController} from './game/vehicles/vehicle-simulation-controller.ts';
import {DeferredCommandQueue} from './game/world/deferred-command-queue.ts';
import {DeterministicRandom} from './game/world/deterministic-random.ts';
import {FixedStepClock} from './game/world/fixed-step-clock.ts';
import {SpatialIndex, type SpatialRecord} from './game/world/spatial-index.ts';
import {DistrictState, NpcState, PlayerState, VehicleState} from './state.ts';
import {CollisionMap} from './world-map.ts';

interface CycleWeaponMessage {
  direction?: number;
}

interface DistrictRoomOptions {
  seed?: number;
}

type WorldEntityKind = 'player' | 'npc' | 'vehicle';

export class DistrictRoom extends Room<DistrictState> {
  maxClients = 32;
  autoDispose = false;
  patchRate = 50;

  private readonly simulationClock = new FixedStepClock();
  private readonly spatialIndex = new SpatialIndex<WorldEntityKind>();
  private readonly lifecycle = new DeferredCommandQueue();
  private readonly events = new GameEventStream();
  private readonly debugSubscribers = new Set<string>();
  private debugProjection!: DebugSnapshotController;
  private missionController!: FreemodeMissionController;
  private crimeController!: CrimeResponseController;
  private vehicleAccess!: VehicleAccessController;
  private trafficController!: TrafficController;
  private vehicleSimulation!: VehicleSimulationController;
  private playerControl!: PlayerControlController;
  private playerLifecycle!: PlayerLifecycleController;
  private damageController!: DamageController;
  private fireControl!: FireControlController;
  private projectileController!: ProjectileController;
  private pedestrians!: PedestrianController;
  private population!: DistrictPopulationController;
  private random = new DeterministicRandom('industrial-district:v1');
  private world!: CollisionMap;

  onCreate(options?: DistrictRoomOptions): void {
    this.simulationClock.reset();
    this.lifecycle.clear();
    this.events.clear();
    this.debugSubscribers.clear();
    const requestedSeed = Number(options?.seed);
    this.random = new DeterministicRandom(
      Number.isFinite(requestedSeed) ? requestedSeed : 'industrial-district:v1'
    );
    this.world = CollisionMap.load();
    this.setState(new DistrictState());
    this.playerControl = new PlayerControlController({
      state: this.state,
      world: this.world
    });
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
      panicWitness: (witnessId, suspectId, untilMs) => this.pedestrians.panic(
        witnessId,
        suspectId,
        untilMs
      )
    });
    this.debugProjection = new DebugSnapshotController({
      enabled: process.env.GAME_DEBUG === '1' || process.env.NODE_ENV !== 'production',
      state: this.state,
      clock: () => ({
        tick: this.simulationClock.tick,
        nowMs: this.simulationClock.nowMs,
        droppedMs: this.simulationClock.droppedMs
      }),
      spatialSize: () => this.spatialIndex.size,
      deferredSize: () => this.lifecycle.size,
      incidents: () => this.crimeController.incidentSnapshot(),
      pursuits: () => this.crimeController.pursuitSnapshot(),
      pedestrians: () => this.pedestrians.diagnostics(),
      stimuli: () => this.pedestrians.stimulusSnapshot(),
      publish: (messageType, snapshot) => {
        for (const client of this.clients) {
          if (this.debugSubscribers.has(client.sessionId)) client.send(messageType, snapshot);
        }
      }
    });
    this.vehicleAccess = new VehicleAccessController({
      state: this.state,
      world: this.world,
      nearbyVehicles: (x, y, radius) => this.spatialIndex.queryCircle(x, y, radius, {
        kinds: ['vehicle']
      }).map((record) => this.state.vehicles.get(record.id))
        .filter((vehicle): vehicle is VehicleState => Boolean(vehicle)),
      createEjectedDriver: (vehicle, hijacker, nowMs) => this.pedestrians.spawnEjectedDriver(
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
      resetInput: (playerId) => this.playerControl.reset(playerId)
    });
    this.damageController = new DamageController({
      state: this.state,
      events: this.events,
      crime: this.crimeController,
      playerLifecycle: this.playerLifecycle,
      clock: () => ({tick: this.simulationClock.tick}),
      panicNpc: (npcId, attackerId, untilMs) => this.pedestrians.panic(
        npcId,
        attackerId,
        untilMs
      ),
      scheduleNpcRespawn: (npcId, respawnAt) => this.pedestrians.scheduleRespawn(
        npcId,
        respawnAt
      )
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
      inputFor: (playerId) => this.playerControl.inputFor(playerId),
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
      clock: () => ({tick: this.simulationClock.tick, nowMs: this.simulationClock.nowMs}),
      events: this.events
    });
    this.pedestrians = new PedestrianController({
      state: this.state,
      world: this.world,
      random: this.random,
      clock: () => ({tick: this.simulationClock.tick}),
      policeTarget: (officer, nowMs) => this.crimeController.policeTarget(officer, nowMs),
      requestPoliceFire: (officerId, x, y, angle, nowMs) => {
        this.fireControl.createNpcBullet(officerId, x, y, angle, nowMs, 'pistol');
      },
      onSpawned: (npc) => this.indexNpc(npc)
    });
    this.population = new DistrictPopulationController({
      state: this.state,
      world: this.world,
      pedestrians: this.pedestrians,
      traffic: this.trafficController,
      onVehicleSpawned: (vehicle) => this.indexVehicle(vehicle)
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
    this.population.populate();
    this.rebuildSpatialIndex();
    this.setSimulationInterval((deltaTime) => this.advanceSimulation(deltaTime), 1000 / 30);

    this.onMessage<PlayerMoveInput>('input', (client, message) => {
      this.playerControl.setMove(client.sessionId, message);
    });

    this.onMessage<PlayerAimInput>('aim', (client, message) => {
      this.playerControl.setAim(client.sessionId, message);
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
    this.onMessage(DEBUG_SUBSCRIBE_MESSAGE, (client) => {
      this.debugSubscribers.add(client.sessionId);
    });
    this.onMessage(DEBUG_UNSUBSCRIBE_MESSAGE, (client) => {
      this.debugSubscribers.delete(client.sessionId);
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
    this.playerControl.register(client.sessionId);
    this.indexPlayer(player);
  }

  onLeave(client: Client): void {
    this.debugSubscribers.delete(client.sessionId);
    const player = this.state.players.get(client.sessionId);
    if (player) this.vehicleAccess.removePlayer(player);
    this.state.players.delete(client.sessionId);
    this.playerControl.unregister(client.sessionId);
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

  private advanceSimulation(deltaTime: number): void {
    this.simulationClock.advance(deltaTime, (frame) => {
      this.updateFixedStep(frame.deltaSeconds, frame.nowMs);
    });
    const events = this.events.drain();
    this.pedestrians.observeEvents(events);
    this.debugProjection.update(events);
  }

  private updateFixedStep(deltaSeconds: number, now: number): void {
    this.vehicleSimulation.beginTick();
    this.state.vehicles.forEach((vehicle) => {
      this.vehicleSimulation.update(vehicle, deltaSeconds, now);
      this.indexVehicle(vehicle);
    });
    this.state.players.forEach((player) => {
      if (!player.alive) {
        this.playerLifecycle.tryRespawn(player, now);
      } else if (player.action) {
        this.vehicleAccess.updateAction(player, now);
      } else {
        this.playerControl.updateOnFoot(player, deltaSeconds);
        this.crimeController.decay(player, now);
      }
      this.indexPlayer(player);
    });
    this.crimeController.processReports(now);
    this.crimeController.updateDispatch(now);
    this.pedestrians.beginTick(now);
    this.state.npcs.forEach((npc) => {
      this.pedestrians.update(npc, deltaSeconds, now);
      this.indexNpc(npc);
    });
    this.state.bullets.forEach((bullet, bulletId) => {
      this.projectileController.update(bullet, bulletId, deltaSeconds, now);
    });
    this.crimeController.expire(now);
    this.missionController.update(now);
    this.lifecycle.flush();
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
    return {id: npc.id, kind: 'npc', x: npc.x, y: npc.y, radius: PEDESTRIAN_RADIUS};
  }

  private vehicleSpatialRecord(vehicle: VehicleState): SpatialRecord<WorldEntityKind> {
    return {id: vehicle.id, kind: 'vehicle', x: vehicle.x, y: vehicle.y, radius: VEHICLE_RADIUS};
  }

}

function sanitizeName(value: unknown, fallbackNumber: number): string {
  const name = String(value ?? '').replace(/[^a-zA-Z0-9 _-]/g, '').trim().slice(0, 18);
  return name || `Driver ${fallbackNumber}`;
}
