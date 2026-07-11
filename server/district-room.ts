import {type Client, Room} from '@colyseus/core';
import {
  DEBUG_SUBSCRIBE_MESSAGE,
  DEBUG_UNSUBSCRIBE_MESSAGE
} from '../shared/protocol/debug.ts';
import {
  APPEARANCE_RESULT_MESSAGE,
  APPEARANCE_UPDATE_MESSAGE,
  type AppearanceUpdateMessage
} from '../shared/protocol/appearance.ts';
import {
  WARDROBE_OPEN_MESSAGE,
  WARDROBE_REQUEST_MESSAGE,
  WARDROBE_STATE_MESSAGE
} from '../shared/protocol/wardrobe.ts';
import {
  MISSION_ABANDON_MESSAGE,
  MISSION_JOIN_MESSAGE,
  MISSION_LAUNCH_MESSAGE,
  MISSION_START_MESSAGE,
  type MissionIdMessage,
  type MissionStartMessage
} from '../shared/protocol/missions.ts';
import {
  MEDICAL_CARE_MESSAGE,
  type MedicalCareMessage
} from '../shared/protocol/medical-care.ts';
import {isMedicalCareKind} from '../shared/content/medical-care.ts';
import {GAME_NOTICE_MESSAGE, type GameNotice} from '../shared/protocol/notices.ts';
import {DebugSnapshotController} from './game/debug/debug-snapshot-controller.ts';
import {GameEventStream} from './game/events/game-events.ts';
import {StreetEconomyController} from './game/economy/street-economy-controller.ts';
import {PlayerInteractionController} from './game/interactions/player-interaction-controller.ts';
import {FreemodeMissionController} from './game/missions/freemode-mission-controller.ts';
import {MedicalCareController} from './game/medical/medical-care-controller.ts';
import {CrimeResponseController} from './game/police/crime-response-controller.ts';
import {PoliceVehicleController} from './game/police/police-vehicle-controller.ts';
import {DistrictPopulationController} from './game/population/district-population-controller.ts';
import {PopulationStreamingController} from './game/population/population-streaming-controller.ts';
import {TrafficController} from './game/traffic/traffic-controller.ts';
import {TrafficSignalController} from './game/traffic/traffic-signal-controller.ts';
import {DamageController} from './game/combat/damage-controller.ts';
import {CombatReactionController} from './game/combat/combat-reaction-controller.ts';
import {FireControlController} from './game/combat/fire-control-controller.ts';
import {MeleeCombatController} from './game/combat/melee-combat-controller.ts';
import {ProjectileController} from './game/combat/projectile-controller.ts';
import {ExplosionController} from './game/combat/explosion-controller.ts';
import {ThrownProjectileController} from './game/combat/thrown-projectile-controller.ts';
import {WeaponPickupController} from './game/pickups/weapon-pickup-controller.ts';
import {CashPickupController} from './game/pickups/cash-pickup-controller.ts';
import {
  PlayerControlController,
  PLAYER_RADIUS,
  type PlayerAimInput,
  type PlayerMoveInput
} from './game/players/player-control-controller.ts';
import {PlayerLifecycleController} from './game/players/player-lifecycle-controller.ts';
import {PlayerAppearanceController} from './game/players/player-appearance-controller.ts';
import {WardrobeInventoryController} from './game/appearance/wardrobe-inventory-controller.ts';
import {StreetServiceController} from './game/services/street-service-controller.ts';
import {InteriorController} from './game/interiors/interior-controller.ts';
import {DistrictReplicationController} from './game/replication/district-replication-controller.ts';
import {
  PedestrianController,
  PEDESTRIAN_RADIUS
} from './game/pedestrians/pedestrian-controller.ts';
import {
  VEHICLE_COLLISION_BOUNDING_RADIUS,
  VEHICLE_RADIUS
} from './game/vehicles/vehicle-config.ts';
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
  private economyController!: StreetEconomyController;
  private missionController!: FreemodeMissionController;
  private medicalController!: MedicalCareController;
  private crimeController!: CrimeResponseController;
  private policeVehicleController!: PoliceVehicleController;
  private vehicleAccess!: VehicleAccessController;
  private trafficController!: TrafficController;
  private trafficSignalController!: TrafficSignalController;
  private vehicleSimulation!: VehicleSimulationController;
  private playerControl!: PlayerControlController;
  private appearanceController!: PlayerAppearanceController;
  private wardrobeController!: WardrobeInventoryController;
  private playerLifecycle!: PlayerLifecycleController;
  private damageController!: DamageController;
  private combatReactions!: CombatReactionController;
  private fireControl!: FireControlController;
  private meleeCombat!: MeleeCombatController;
  private interactionController!: PlayerInteractionController;
  private projectileController!: ProjectileController;
  private explosionController!: ExplosionController;
  private thrownProjectileController!: ThrownProjectileController;
  private weaponPickupController!: WeaponPickupController;
  private cashPickupController!: CashPickupController;
  private pedestrians!: PedestrianController;
  private population!: DistrictPopulationController;
  private populationStreaming!: PopulationStreamingController;
  private serviceController!: StreetServiceController;
  private interiorController!: InteriorController;
  private replicationController!: DistrictReplicationController;
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
    this.replicationController = new DistrictReplicationController(this.state, {
      queryStreetActors: (x, y, radius) => this.spatialIndex.queryCircle(x, y, radius, {
        kinds: ['npc', 'vehicle'],
        includeRecordRadius: true
      }).map((record) => {
        const schema = record.kind === 'npc'
          ? this.state.npcs.get(record.id)
          : this.state.vehicles.get(record.id);
        return schema ? {
          id: record.id,
          kind: record.kind as 'npc' | 'vehicle',
          x: record.x,
          y: record.y,
          schema
        } : undefined;
      }).filter((record): record is NonNullable<typeof record> => Boolean(record))
    });
    this.interiorController = new InteriorController();
    this.economyController = new StreetEconomyController({
      state: this.state,
      events: this.events,
      clock: () => ({tick: this.simulationClock.tick})
    });
    this.playerControl = new PlayerControlController({
      state: this.state,
      world: this.world,
      interiors: this.interiorController
    });
    this.wardrobeController = new WardrobeInventoryController();
    this.appearanceController = new PlayerAppearanceController({
      state: this.state,
      clock: () => ({nowMs: this.simulationClock.nowMs}),
      wardrobe: this.wardrobeController
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
      queryVehicles: (x, y, radius) => this.spatialIndex.queryCircle(
        x,
        y,
        radius,
        {kinds: ['vehicle']}
      ).map((record) => this.state.vehicles.get(record.id))
        .filter((vehicle): vehicle is VehicleState => Boolean(vehicle)),
      panicWitness: (witnessId, suspectId, untilMs) => this.pedestrians.panic(
        witnessId,
        suspectId,
        untilMs
      )
    });
    this.policeVehicleController = new PoliceVehicleController({
      world: this.world,
      targets: () => this.crimeController.policeVehicleTargets()
    });
    this.medicalController = new MedicalCareController({
      state: this.state,
      world: this.world,
      economy: this.economyController,
      clock: () => ({tick: this.simulationClock.tick}),
      notice: (playerId, message, tone) => this.noticePlayer(playerId, message, tone)
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
      traffic: () => this.trafficController.diagnostics(),
      trafficSignals: () => this.trafficSignalController.diagnostics(),
      policeVehicles: () => this.policeVehicleController.diagnostics(),
      replication: () => this.replicationController.diagnostics(),
      population: () => this.populationStreaming.diagnostics(),
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
      events: this.events,
      access: this.vehicleAccess,
      crime: this.crimeController,
      medical: this.medicalController,
      clock: () => ({tick: this.simulationClock.tick}),
      resetInput: (playerId) => this.playerControl.reset(playerId)
    });
    this.combatReactions = new CombatReactionController({
      state: this.state,
      interruptPlayer: (player) => {
        if (player.action === 'melee') this.meleeCombat?.clearPlayer(player.id);
        this.vehicleAccess.cancelAction(player);
        this.playerControl.reset(player.id);
      }
    });
    this.damageController = new DamageController({
      events: this.events,
      economy: this.economyController,
      crime: this.crimeController,
      playerLifecycle: this.playerLifecycle,
      reactions: this.combatReactions,
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
      .filter((player): player is PlayerState => Boolean(player && player.spaceId === 'street'));
    const nearbyNpcs = (x: number, y: number, radius: number) => this.spatialIndex.queryCircle(
      x,
      y,
      radius,
      {kinds: ['npc'], includeRecordRadius: true}
    ).map((record) => this.state.npcs.get(record.id))
      .filter((npc): npc is NpcState => Boolean(npc));
    const nearbyVehicles = (x: number, y: number, radius: number) => this.spatialIndex.queryCircle(
      x,
      y,
      radius,
      {kinds: ['vehicle'], includeRecordRadius: true}
    ).map((record) => this.state.vehicles.get(record.id))
      .filter((vehicle): vehicle is VehicleState => Boolean(vehicle));
    this.trafficSignalController = new TrafficSignalController({
      state: this.state,
      world: this.world,
      nearbyVehicles
    });
    this.vehicleSimulation = new VehicleSimulationController({
      state: this.state,
      world: this.world,
      events: this.events,
      access: this.vehicleAccess,
      traffic: this.trafficController,
      signals: this.trafficSignalController,
      policeVehicles: this.policeVehicleController,
      clock: () => ({tick: this.simulationClock.tick}),
      inputFor: (playerId) => this.playerControl.inputFor(playerId),
      nearbyPlayers,
      nearbyNpcs,
      nearbyVehicles,
      damagePlayer: (player, damage, attackerId, nowMs, crimeKind, impact) => this.damageController.player(
        player,
        damage,
        attackerId,
        nowMs,
        crimeKind,
        undefined,
        impact
      ),
      damageNpc: (npc, damage, attackerId, nowMs, crimeKind, impact) => this.damageController.npc(
        npc,
        damage,
        attackerId,
        nowMs,
        crimeKind,
        impact
      )
    });
    this.explosionController = new ExplosionController({
      state: this.state,
      events: this.events,
      clock: () => ({tick: this.simulationClock.tick}),
      damage: this.damageController,
      vehicles: this.vehicleSimulation,
      queryPlayers: nearbyPlayers,
      queryNpcs: nearbyNpcs,
      queryVehicles: nearbyVehicles
    });
    this.thrownProjectileController = new ThrownProjectileController({
      state: this.state,
      world: this.world,
      detonate: (x, y, ownerId, nowMs) => {
        this.explosionController.detonate('grenade', x, y, ownerId, 'player', nowMs);
      },
      remove: (projectileId) => this.lifecycle.defer(
        `thrown.remove:${projectileId}`,
        () => this.state.thrownProjectiles.delete(projectileId)
      )
    });
    this.meleeCombat = new MeleeCombatController({
      state: this.state,
      world: this.world,
      events: this.events,
      clock: () => ({tick: this.simulationClock.tick}),
      cancelSpawnProtection: (playerId) => this.playerLifecycle.cancelProtection(playerId),
      queryPlayers: nearbyPlayers,
      queryNpcs: nearbyNpcs,
      queryVehicles: nearbyVehicles,
      damagePlayer: (target, damage, attackerId, nowMs, impact) => this.damageController.player(
        target,
        damage,
        attackerId,
        nowMs,
        undefined,
        undefined,
        impact
      ),
      damageNpc: (target, damage, attackerId, nowMs, impact) => this.damageController.npc(
        target,
        damage,
        attackerId,
        nowMs,
        undefined,
        impact
      ),
      damageVehicle: (target, damage, attackerId, nowMs, zone) => this.vehicleSimulation.damage(
        target,
        damage,
        attackerId,
        'weapon',
        nowMs,
        zone
      )
    });
    this.fireControl = new FireControlController({
      state: this.state,
      random: this.random,
      clock: () => ({tick: this.simulationClock.tick, nowMs: this.simulationClock.nowMs}),
      events: this.events,
      cancelSpawnProtection: (playerId) => this.playerLifecycle.cancelProtection(playerId),
      throwExplosive: (input) => this.thrownProjectileController.throw(input),
      meleeAttack: (input) => this.meleeCombat.begin(
        input.playerId,
        input.weapon,
        input.nowMs
      )
    });
    this.weaponPickupController = new WeaponPickupController({
      state: this.state,
      world: this.world,
      events: this.events,
      clock: () => ({tick: this.simulationClock.tick}),
      nearbyPlayers,
      notice: (playerId, message, tone) => this.noticePlayer(playerId, message, tone)
    });
    this.cashPickupController = new CashPickupController({
      state: this.state,
      world: this.world,
      economy: this.economyController,
      events: this.events,
      clock: () => ({tick: this.simulationClock.tick}),
      nearbyPlayers,
      notice: (playerId, message, tone) => this.noticePlayer(playerId, message, tone)
    });
    const sendWardrobeState = (playerId: string) => {
      const client = this.clients.find((candidate) => candidate.sessionId === playerId);
      client?.send(WARDROBE_STATE_MESSAGE, this.wardrobeController.snapshot(playerId));
    };
    this.serviceController = new StreetServiceController({
      state: this.state,
      world: this.world,
      economy: this.economyController,
      clock: () => ({tick: this.simulationClock.tick}),
      repairVehicle: (vehicle) => this.vehicleSimulation.repair(vehicle),
      restockPlayer: (playerId) => {
        this.fireControl.restock(playerId);
        const player = this.state.players.get(playerId);
        if (player) player.armor = 100;
      },
      medical: this.medicalController,
      openWardrobe: (playerId, serviceId) => {
        const client = this.clients.find((candidate) => candidate.sessionId === playerId);
        sendWardrobeState(playerId);
        client?.send(WARDROBE_OPEN_MESSAGE, {serviceId});
      },
      notice: (playerId, message, tone) => this.noticePlayer(playerId, message, tone)
    });
    this.interactionController = new PlayerInteractionController({
      services: this.serviceController,
      vehicles: this.vehicleAccess,
      canUseVehicles: (playerId) => this.state.players.get(playerId)?.spaceId === 'street'
    });
    this.pedestrians = new PedestrianController({
      state: this.state,
      world: this.world,
      random: this.random,
      clock: () => ({tick: this.simulationClock.tick}),
      events: this.events,
      policeTarget: (officer, nowMs) => this.crimeController.policeTarget(officer, nowMs),
      requestPoliceFire: (officerId, x, y, angle, nowMs) => {
        this.fireControl.createNpcBullet(officerId, x, y, angle, nowMs, 'pistol');
      },
      requestHostileFire: (actorId, x, y, angle, nowMs, weapon) => {
        this.fireControl.createNpcBullet(actorId, x, y, angle, nowMs, weapon, 'hostile');
      },
      damagePlayer: (target, damage, attackerId, nowMs, impact) => {
        this.damageController.player(
          target,
          damage,
          attackerId,
          nowMs,
          undefined,
          'non-player',
          impact
        );
      },
      onSpawned: (npc) => this.indexNpc(npc),
      onDespawned: (npcId) => this.spatialIndex.remove('npc', npcId)
    });
    this.population = new DistrictPopulationController({
      state: this.state,
      world: this.world,
      pedestrians: this.pedestrians,
      traffic: this.trafficController,
      includeAmbientTraffic: false,
      onVehicleSpawned: (vehicle) => {
        this.indexVehicle(vehicle);
        if (vehicle.kind === 'police') this.policeVehicleController.register(vehicle.id);
      }
    });
    this.populationStreaming = new PopulationStreamingController({
      state: this.state,
      world: this.world,
      random: this.random,
      pedestrians: this.pedestrians,
      traffic: this.trafficController,
      onVehicleMaterialized: (vehicle) => this.indexVehicle(vehicle),
      onVehicleDematerialized: (vehicleId) => this.spatialIndex.remove('vehicle', vehicleId)
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
      economy: this.economyController,
      clock: () => ({tick: this.simulationClock.tick, nowMs: this.simulationClock.nowMs}),
      notice: (playerId, message, tone) => this.noticePlayer(playerId, message, tone),
      spawnMissionHostile: (spawn) => {
        this.pedestrians.spawnMissionHostile(
          spawn.actorId,
          spawn.centerX,
          spawn.centerY,
          spawn.minDistance,
          spawn.maxDistance,
          spawn.health,
          spawn.weapon,
          spawn.fireCooldownMs,
          spawn.seed
        );
      },
      assignHostileTarget: (actorId, playerId) => this.pedestrians.assignCombatTarget(
        actorId,
        playerId
      ),
      despawnMissionNpc: (actorId) => {
        this.pedestrians.despawn(actorId);
      },
      releaseDeliveredVehicle: (vehicle, nowMs) => this.vehicleSimulation.returnToTraffic(
        vehicle,
        nowMs
      )
    });
    this.serviceController.initialize();
    this.medicalController.initialize();
    this.weaponPickupController.initialize();
    this.trafficSignalController.initialize(this.simulationClock.nowMs);
    this.population.populate();
    this.populationStreaming.initialize(this.simulationClock.nowMs);
    this.rebuildSpatialIndex();
    this.setSimulationInterval((deltaTime) => this.advanceSimulation(deltaTime), 1000 / 30);

    this.onMessage<PlayerMoveInput>('input', (client, message) => {
      this.playerControl.setMove(client.sessionId, message);
    });

    this.onMessage<PlayerAimInput>('aim', (client, message) => {
      this.playerControl.setAim(client.sessionId, message);
    });

    this.onMessage('shoot', (client) => {
      const player = this.state.players.get(client.sessionId);
      if (player?.spaceId === 'street') this.fireControl.shoot(client.sessionId);
    });
    this.onMessage<CycleWeaponMessage>('cycleWeapon', (client, message) => {
      this.fireControl.cycle(client.sessionId, message?.direction);
    });
    this.onMessage<AppearanceUpdateMessage>(APPEARANCE_UPDATE_MESSAGE, (client, message) => {
      const status = this.appearanceController.update(client.sessionId, message);
      client.send(APPEARANCE_RESULT_MESSAGE, {status});
    });
    this.onMessage(WARDROBE_REQUEST_MESSAGE, (client) => sendWardrobeState(client.sessionId));
    this.onMessage<MedicalCareMessage>(MEDICAL_CARE_MESSAGE, (client, message) => {
      if (!isMedicalCareKind(message?.kind)) return;
      this.medicalController.select(client.sessionId, message.kind, this.simulationClock.nowMs);
    });
    this.onMessage('interact', (client) => {
      this.interactionController.interact(
        client.sessionId,
        this.simulationClock.nowMs,
        this.simulationClock.tick
      );
    });
    this.onMessage<MissionStartMessage>(MISSION_START_MESSAGE, (client, message) => {
      this.missionController.start(client.sessionId, message?.templateId);
    });
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

  onJoin(client: Client, options: {name?: string; appearance?: unknown}): void {
    const spawn = this.world.spawnFor(this.state.players.size, PLAYER_RADIUS);
    const player = new PlayerState();
    player.id = client.sessionId;
    player.armor = 25;
    player.name = sanitizeName(options?.name, this.state.players.size + 1);
    player.x = spawn.x;
    player.y = spawn.y;
    player.angle = -Math.PI / 2;
    this.wardrobeController.initialize(client.sessionId);
    this.appearanceController.initialize(player, options?.appearance);
    this.state.players.set(client.sessionId, player);
    client.view = this.replicationController.attach(client.sessionId);
    this.playerControl.register(client.sessionId);
    this.indexPlayer(player);
  }

  onLeave(client: Client): void {
    this.replicationController.detach(client.sessionId);
    this.debugSubscribers.delete(client.sessionId);
    const player = this.state.players.get(client.sessionId);
    if (player) this.vehicleAccess.removePlayer(player);
    this.state.players.delete(client.sessionId);
    this.playerControl.unregister(client.sessionId);
    this.playerLifecycle.clearPlayer(client.sessionId);
    this.appearanceController.clearPlayer(client.sessionId);
    this.wardrobeController.clearPlayer(client.sessionId);
    this.medicalController.clearPlayer(client.sessionId);
    this.interactionController.clearPlayer(client.sessionId);
    this.fireControl.clearPlayer(client.sessionId);
    this.meleeCombat.clearPlayer(client.sessionId);
    this.combatReactions.clearPlayer(client.sessionId);
    this.crimeController.clearSuspect(client.sessionId);
    this.spatialIndex.remove('player', client.sessionId);
  }

  private noticePlayer(
    playerId: string,
    message: string,
    tone: GameNotice['tone']
  ): void {
    const client = this.clients.find((candidate) => candidate.sessionId === playerId);
    client?.send(GAME_NOTICE_MESSAGE, {message, tone} satisfies GameNotice);
  }

  private advanceSimulation(deltaTime: number): void {
    this.simulationClock.advance(deltaTime, (frame) => {
      this.updateFixedStep(frame.deltaSeconds, frame.nowMs);
      const events = this.events.drain();
      this.explosionController.observeEvents(events);
      this.missionController.observeEvents(events);
      this.pedestrians.observeEvents(events);
      this.cashPickupController.observeEvents(events);
      this.debugProjection.update(events);
    });
  }

  onBeforePatch(): void {
    this.replicationController.synchronize();
  }

  private updateFixedStep(deltaSeconds: number, now: number): void {
    this.populationStreaming.update(
      [...this.state.players.values()]
        .filter((player) => player.spaceId === 'street')
        .map((player) => ({x: player.x, y: player.y})),
      now
    );
    this.trafficSignalController.beginTick();
    this.trafficSignalController.update(now);
    this.explosionController.update(now);
    this.vehicleSimulation.beginTick();
    this.state.vehicles.forEach((vehicle) => {
      this.vehicleSimulation.update(vehicle, deltaSeconds, now);
      this.indexVehicle(vehicle);
    });
    this.combatReactions.update(now);
    this.meleeCombat.update(now);
    this.state.players.forEach((player) => {
      if (!player.alive) {
        this.playerLifecycle.tryRespawn(player, now);
      } else if (player.action) {
        this.playerLifecycle.updateProtection(player, now);
        if (player.action === 'melee') this.playerControl.updateOnFoot(player, deltaSeconds);
        else this.vehicleAccess.updateAction(player, now);
      } else {
        this.playerLifecycle.updateProtection(player, now);
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
    this.state.thrownProjectiles.forEach((projectile, projectileId) => {
      this.thrownProjectileController.update(projectile, projectileId, deltaSeconds, now);
    });
    this.weaponPickupController.update(now);
    this.cashPickupController.update(now);
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
    return {
      id: vehicle.id,
      kind: 'vehicle',
      x: vehicle.x,
      y: vehicle.y,
      radius: VEHICLE_COLLISION_BOUNDING_RADIUS
    };
  }

}

function sanitizeName(value: unknown, fallbackNumber: number): string {
  const name = String(value ?? '').replace(/[^a-zA-Z0-9 _-]/g, '').trim().slice(0, 18);
  return name || `Driver ${fallbackNumber}`;
}
