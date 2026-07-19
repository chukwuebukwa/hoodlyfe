import {join} from 'node:path';
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
import {
  RADIO_STATION_MESSAGE,
  type RadioStationMessage
} from '../shared/protocol/radio.ts';
import {
  PLAYER_SPAWN_MESSAGE,
  type PlayerSpawnMessage
} from '../shared/protocol/onboarding.ts';
import type {ClientAuthPayload, VerifiedAuthIdentity} from '../shared/protocol/auth.ts';
import {
  NETWORK_PING_MESSAGE,
  NETWORK_PONG_MESSAGE,
  type NetworkPingMessage
} from '../shared/protocol/network-quality.ts';
import {
  COMBAT_FIRE_MESSAGE,
  type CombatFireCommand
} from '../shared/protocol/combat-fire.ts';
import {
  NETCODE_ROLLOUT_MANIFEST_MESSAGE,
  NETCODE_ROLLOUT_REQUEST_MESSAGE,
  validateNetcodeRolloutRequest,
  type NetcodeRolloutRequest
} from '../shared/protocol/netcode-rollout.ts';
import {WORLD_COLLISION_REVISION} from '../shared/simulation/world-collision-revision.ts';
import {worldMinuteAt} from '../shared/content/world-time.ts';
import {verifyClientAuth} from './auth/client-auth.ts';
import {DebugSnapshotController} from './game/debug/debug-snapshot-controller.ts';
import {AudioEventController} from './game/audio/audio-event-controller.ts';
import {ProximityVoiceController} from './game/audio/proximity-voice-controller.ts';
import {GameEventStream} from './game/events/game-events.ts';
import {FileJournalSink, type JournalSink} from './game/journal/journal-sink.ts';
import {SimulationJournal} from './game/journal/simulation-journal.ts';
import {hashDistrictState} from './game/journal/state-hash.ts';
import {StreetEconomyController} from './game/economy/street-economy-controller.ts';
import {PlayerInteractionController} from './game/interactions/player-interaction-controller.ts';
import {FreemodeMissionController} from './game/missions/freemode-mission-controller.ts';
import {MedicalCareController} from './game/medical/medical-care-controller.ts';
import {CrimeResponseController} from './game/police/crime-response-controller.ts';
import {CustodyOutcomeController} from './game/police/custody-outcome-controller.ts';
import {PoliceArrestController} from './game/police/police-arrest-controller.ts';
import {PoliceVehicleController} from './game/police/police-vehicle-controller.ts';
import {PoliceResponseFleetController} from './game/police/police-response-fleet-controller.ts';
import {PoliceRoadblockController} from './game/police/police-roadblock-controller.ts';
import {PoliceStingerController} from './game/police/police-stinger-controller.ts';
import {DistrictPopulationController} from './game/population/district-population-controller.ts';
import {PopulationStreamingController} from './game/population/population-streaming-controller.ts';
import {WorldClockController} from './game/world/world-clock-controller.ts';
import {TrafficController} from './game/traffic/traffic-controller.ts';
import {LaneGraph} from './game/traffic/lane-graph.ts';
import {TrafficSignalController} from './game/traffic/traffic-signal-controller.ts';
import {RoadClosureRegistry} from './game/traffic/road-closure-registry.ts';
import {DamageController} from './game/combat/damage-controller.ts';
import {CombatReactionController} from './game/combat/combat-reaction-controller.ts';
import {FireControlController} from './game/combat/fire-control-controller.ts';
import {CombatHitboxHistory} from './game/combat/combat-hitbox-history.ts';
import {CombatFireCommandController} from './game/combat/combat-fire-command-controller.ts';
import {MeleeCombatController} from './game/combat/melee-combat-controller.ts';
import {ProjectileController} from './game/combat/projectile-controller.ts';
import {ExplosionController} from './game/combat/explosion-controller.ts';
import {ThrownProjectileController} from './game/combat/thrown-projectile-controller.ts';
import {FireZoneController} from './game/combat/fire-zone-controller.ts';
import {ActorBurnController} from './game/combat/actor-burn-controller.ts';
import {RocketProjectileController} from './game/combat/rocket-projectile-controller.ts';
import {WeaponPickupController} from './game/pickups/weapon-pickup-controller.ts';
import {CashPickupController} from './game/pickups/cash-pickup-controller.ts';
import {NetworkProbeController} from './game/network/network-probe-controller.ts';
import {resolveNetcodeRolloutManifest} from './game/network/netcode-rollout-config.ts';
import {initializePhysicsEngine, PhysicsWorld} from '../shared/physics/physics-world.ts';
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
import {PedestrianController} from './game/pedestrians/pedestrian-controller.ts';
import {PEDESTRIAN_RADIUS} from './game/pedestrians/pedestrian-config.ts';
import {
  VEHICLE_COLLISION_BOUNDING_RADIUS,
  VEHICLE_RADIUS
} from './game/vehicles/vehicle-config.ts';
import {VehicleAccessController} from './game/vehicles/vehicle-access-controller.ts';
import {VehicleSimulationController} from './game/vehicles/vehicle-simulation-controller.ts';
import {VehicleInputController} from './game/vehicles/vehicle-input-controller.ts';
import {
  VEHICLE_INPUT_MESSAGE,
  type VehicleInputBatchMessage
} from '../shared/protocol/vehicle-input.ts';
import {
  ON_FOOT_INPUT_MESSAGE,
  type OnFootInputBatchMessage
} from '../shared/protocol/on-foot-input.ts';
import {VOICE_TOKEN_REQUEST_MESSAGE} from '../shared/protocol/proximity-voice.ts';
import {DeferredCommandQueue} from './game/world/deferred-command-queue.ts';
import {DeterministicRandom} from './game/world/deterministic-random.ts';
import {DistrictSimulation} from './game/world/district-simulation.ts';
import {FixedStepClock} from './game/world/fixed-step-clock.ts';
import {SpatialIndex, type SpatialRecord} from './game/world/spatial-index.ts';
import {WorldStimulusAdapter} from './game/world/world-stimulus-adapter.ts';
import {WorldStimulusRegistry} from './game/world/world-stimulus-registry.ts';
import {DistrictState, NpcState, PlayerState, VehicleState} from './state.ts';
import {CollisionMap} from './world-map.ts';

interface CycleWeaponMessage {
  direction?: number;
}

const RADIO_STATION_IDS = new Set(['station-0', 'station-1', 'station-3', 'radio-off']);

interface DistrictRoomOptions {
  seed?: number | string;
  epochMs?: number;
  journalSink?: JournalSink;
  journalHashIntervalTicks?: number;
  // Skip the wall-clock simulation interval so a harness can call stepSimulationTick().
  externalSimulation?: boolean;
}

interface JournaledCommandClient {
  sessionId: string;
  send(type: string, payload?: unknown): void;
}

interface DistrictJoinOptions {
  name?: string;
  appearance?: unknown;
  auth?: ClientAuthPayload;
  spectator?: boolean;
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
  private readonly worldStimuli = new WorldStimulusRegistry();
  private readonly debugSubscribers = new Set<string>();
  private readonly authIdentities = new Map<string, VerifiedAuthIdentity>();
  private readonly networkProbe = new NetworkProbeController({
    region: process.env.RAILWAY_REPLICA_REGION ?? process.env.GAME_REGION ?? 'local',
    buildId: process.env.RAILWAY_GIT_COMMIT_SHA ?? process.env.GIT_COMMIT_SHA ??
      process.env.RAILWAY_DEPLOYMENT_ID ?? 'development'
  });
  private readonly netcodeRollout = resolveNetcodeRolloutManifest();
  private physicsWorld!: PhysicsWorld;
  private simulation!: DistrictSimulation;
  private worldStimulusAdapter!: WorldStimulusAdapter;
  private debugProjection!: DebugSnapshotController;
  private audioEvents!: AudioEventController;
  private voiceChat!: ProximityVoiceController;
  private economyController!: StreetEconomyController;
  private missionController!: FreemodeMissionController;
  private medicalController!: MedicalCareController;
  private crimeController!: CrimeResponseController;
  private custodyController!: CustodyOutcomeController;
  private policeArrests!: PoliceArrestController;
  private policeVehicleController!: PoliceVehicleController;
  private vehicleAccess!: VehicleAccessController;
  private trafficController!: TrafficController;
  private laneGraph!: LaneGraph;
  private trafficSignalController!: TrafficSignalController;
  private vehicleSimulation!: VehicleSimulationController;
  private vehicleInput!: VehicleInputController;
  private playerControl!: PlayerControlController;
  private appearanceController!: PlayerAppearanceController;
  private wardrobeController!: WardrobeInventoryController;
  private playerLifecycle!: PlayerLifecycleController;
  private damageController!: DamageController;
  private combatReactions!: CombatReactionController;
  private fireControl!: FireControlController;
  private readonly combatHistory = new CombatHitboxHistory();
  private combatFireCommands!: CombatFireCommandController;
  private meleeCombat!: MeleeCombatController;
  private interactionController!: PlayerInteractionController;
  private projectileController!: ProjectileController;
  private explosionController!: ExplosionController;
  private thrownProjectileController!: ThrownProjectileController;
  private fireZoneController!: FireZoneController;
  private actorBurnController!: ActorBurnController;
  private rocketProjectileController!: RocketProjectileController;
  private weaponPickupController!: WeaponPickupController;
  private cashPickupController!: CashPickupController;
  private pedestrians!: PedestrianController;
  private population!: DistrictPopulationController;
  private populationStreaming!: PopulationStreamingController;
  private policeResponseFleet!: PoliceResponseFleetController;
  private policeRoadblocks!: PoliceRoadblockController;
  private policeStingers!: PoliceStingerController;
  private roadClosures!: RoadClosureRegistry;
  private worldClock!: WorldClockController;
  private serviceController!: StreetServiceController;
  private interiorController!: InteriorController;
  private replicationController!: DistrictReplicationController;
  private random = new DeterministicRandom('industrial-district:v1');
  private journal?: SimulationJournal;
  private epochMs = 0;
  private readonly journaledCommands = new Map<
    string,
    (client: JournaledCommandClient, payload: unknown) => void
  >();
  private world!: CollisionMap;

  async onCreate(options?: DistrictRoomOptions): Promise<void> {
    this.simulationClock.reset();
    this.lifecycle.clear();
    this.events.clear();
    this.worldStimuli.clear();
    this.combatHistory.clear();
    this.debugSubscribers.clear();
    const seed = resolveSeed(options?.seed);
    this.random = new DeterministicRandom(seed);
    const requestedEpoch = Number(options?.epochMs);
    this.epochMs = Number.isFinite(requestedEpoch) ? requestedEpoch : Date.now();
    this.journal?.close();
    this.journal = undefined;
    this.journaledCommands.clear();
    this.world = CollisionMap.load();
    this.physicsWorld?.free();
    await initializePhysicsEngine();
    this.physicsWorld = PhysicsWorld.create(this.world.physicsGeometry());
    this.laneGraph = LaneGraph.load(this.world);
    this.roadClosures = new RoadClosureRegistry();
    this.setState(new DistrictState());
    this.voiceChat = new ProximityVoiceController({
      state: this.state,
      roomName: `nock0:${this.roomId}`,
      send: (playerId, type, payload) => {
        this.clients.find((client) => client.sessionId === playerId)?.send(type, payload);
      }
    });
    const journalSink = options?.journalSink ?? environmentJournalSink(this.roomId);
    if (journalSink) {
      this.journal = new SimulationJournal({
        sink: journalSink,
        seed,
        epochMs: this.epochMs,
        stepMs: this.simulationClock.stepMs,
        collisionRevision: WORLD_COLLISION_REVISION,
        rolloutRevision: this.netcodeRollout.revision,
        hashState: () => hashDistrictState(this.state),
        hashIntervalTicks: options?.journalHashIntervalTicks,
        onFailure: (error) => console.error('Simulation journal disabled after sink error:', error)
      });
    }
    this.worldStimulusAdapter = new WorldStimulusAdapter({
      state: this.state,
      registry: this.worldStimuli
    });
    this.worldClock = new WorldClockController({
      state: this.state,
      // Sim-derived time keeps the world clock reproducible under journal replay.
      now: () => this.epochMs + this.simulationClock.nowMs
    });
    this.worldClock.initialize();
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
    this.vehicleInput = new VehicleInputController(this.state);
    this.wardrobeController = new WardrobeInventoryController();
    this.appearanceController = new PlayerAppearanceController({
      state: this.state,
      clock: () => ({nowMs: this.simulationClock.nowMs}),
      wardrobe: this.wardrobeController
    });
    this.trafficController = new TrafficController({
      world: this.world,
      random: this.random,
      laneGraph: this.laneGraph,
      closures: this.roadClosures
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
      ),
      isReservedPoliceUnit: (kind, unitId) => (
        (kind === 'vehicle' && this.policeRoadblocks?.ownsVehicle(unitId)) ||
        (kind === 'foot' && this.policeStingers?.ownsOfficer(unitId))
      )
    });
    this.policeVehicleController = new PoliceVehicleController({
      world: this.world,
      targetFor: (vehicleId) => this.crimeController.policeVehicleTarget(vehicleId),
      forgetTarget: (vehicleId, suspectId, reportedAt, nowMs) => (
        this.crimeController.forgetPoliceVehicleTarget(vehicleId, suspectId, reportedAt, nowMs)
      ),
      reportTactic: (vehicleId, phase, goalX, goalY) => (
        this.crimeController.recordPoliceVehicleTactic(vehicleId, phase, goalX, goalY)
      )
    });
    this.policeResponseFleet = new PoliceResponseFleetController({
      state: this.state,
      world: this.world,
      responsePlan: () => this.crimeController.responseFleetPlan(),
      police: this.policeVehicleController,
      onVehicleSpawned: (vehicle) => this.indexVehicle(vehicle),
      onVehicleRemoved: (vehicleId) => this.spatialIndex.remove('vehicle', vehicleId)
    });
    this.policeRoadblocks = new PoliceRoadblockController({
      state: this.state,
      world: this.world,
      laneGraph: this.laneGraph,
      closures: this.roadClosures,
      responsePlan: () => this.crimeController.responseFleetPlan(),
      traffic: this.trafficController,
      events: this.events,
      clock: () => ({tick: this.simulationClock.tick}),
      onVehicleSpawned: (vehicle) => this.indexVehicle(vehicle),
      onVehicleRemoved: (vehicleId) => this.spatialIndex.remove('vehicle', vehicleId)
    });
    this.medicalController = new MedicalCareController({
      state: this.state,
      world: this.world,
      economy: this.economyController,
      clock: () => ({tick: this.simulationClock.tick}),
      notice: (playerId, message, tone) => this.noticePlayer(playerId, message, tone)
    });
    this.custodyController = new CustodyOutcomeController({
      world: this.world,
      economy: this.economyController,
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
      stimuli: () => this.worldStimuli.snapshot(),
      traffic: () => this.trafficController.diagnostics(),
      trafficLaneGraph: () => ({
        schemaVersion: this.laneGraph.schemaVersion,
        districtId: this.laneGraph.districtId,
        nodes: this.laneGraph.nodes().map(({id, x, y, junctionId}) => ({id, x, y, junctionId})),
        edges: this.laneGraph.edges().map(({
          id,
          fromNodeId,
          toNodeId,
          kind,
          turn,
          speedLimit,
          junctionId
        }) => ({id, fromNodeId, toNodeId, kind, turn, speedLimit, junctionId}))
      }),
      trafficSignals: () => this.trafficSignalController.diagnostics(),
      policeVehicles: () => this.policeVehicleController.diagnostics(),
      policeFleet: () => this.policeResponseFleet.diagnostics(),
      policeResponse: () => this.crimeController.responseAllocationSnapshot(),
      policeTactics: () => this.crimeController.pursuitTacticsSnapshot(),
      policeArrests: () => this.policeArrests?.diagnostics() ?? [],
      policeRoadblocks: () => this.policeRoadblocks?.diagnostics() ?? [],
      policeStingers: () => this.policeStingers?.diagnostics() ?? [],
      replication: () => this.replicationController.diagnostics(),
      population: () => this.populationStreaming.diagnostics(),
      simulationPhases: () => this.simulation?.diagnostics() ?? [],
      publish: (messageType, snapshot) => {
        for (const client of this.clients) {
          if (this.debugSubscribers.has(client.sessionId)) client.send(messageType, snapshot);
        }
      }
    });
    this.audioEvents = new AudioEventController({
      state: this.state,
      clients: () => this.clients
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
      custody: this.custodyController,
      clock: () => ({tick: this.simulationClock.tick}),
      resetInput: (playerId) => this.playerControl.reset(playerId),
      clearCombatState: (playerId) => {
        this.meleeCombat?.clearPlayer(playerId);
        this.combatReactions?.clearPlayer(playerId);
      }
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
      physics: this.physicsWorld,
      clock: () => ({tick: this.simulationClock.tick}),
      inputFor: (playerId) => {
        const player = this.state.players.get(playerId);
        return player?.vehicleId
          ? this.vehicleInput.consume(playerId, player.vehicleId) ?? this.playerControl.inputFor(playerId)
          : this.playerControl.inputFor(playerId);
      },
      acknowledgeInput: (playerId, vehicleId, sequence) => {
        this.vehicleInput.acknowledge(playerId, vehicleId, sequence);
      },
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
      ),
      retireStreamedVehicle: (vehicleId, nowMs) => (
        this.populationStreaming?.retireDestroyedVehicle(vehicleId, nowMs) ?? false
      ),
      onVehicleRemoved: (vehicleId) => this.spatialIndex.remove('vehicle', vehicleId)
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
    this.actorBurnController = new ActorBurnController({
      state: this.state,
      damage: this.damageController
    });
    this.fireZoneController = new FireZoneController({
      state: this.state,
      events: this.events,
      clock: () => ({tick: this.simulationClock.tick}),
      burn: this.actorBurnController,
      vehicles: this.vehicleSimulation,
      queryPlayers: nearbyPlayers,
      queryNpcs: nearbyNpcs,
      queryVehicles: nearbyVehicles
    });
    this.thrownProjectileController = new ThrownProjectileController({
      state: this.state,
      world: this.world,
      resolve: (kind, x, y, ownerId, nowMs, surfaceId) => {
        if (kind === 'molotov') {
          this.fireZoneController.ignite(x, y, ownerId, nowMs, surfaceId);
        } else {
          this.explosionController.detonate(
            'grenade', x, y, ownerId, 'player', nowMs, surfaceId
          );
        }
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
      launchRocket: (input) => this.rocketProjectileController.launch(input),
      meleeAttack: (input) => this.meleeCombat.begin(
        input.playerId,
        input.weapon,
        input.nowMs
      ),
      compensateBullet: (input) => this.projectileController.catchUp(input)
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
    this.policeArrests = new PoliceArrestController({
      state: this.state,
      world: this.world,
      events: this.events,
      clock: () => ({tick: this.simulationClock.tick}),
      targetFor: (officer, nowMs) => this.crimeController.policeTarget(officer, nowMs),
      completeArrest: (player, arrestId, officerId, wantedLevel, nowMs) => (
        this.playerLifecycle.completeArrest(
          player,
          arrestId,
          officerId,
          wantedLevel,
          nowMs
        )
      ),
      interruptPlayer: (player) => {
        if (player.action === 'melee') this.meleeCombat.clearPlayer(player.id);
        this.combatReactions.clearPlayer(player.id);
        this.vehicleAccess.cancelAction(player);
      },
      resetInput: (playerId) => this.playerControl.reset(playerId),
      recordTactic: (officerId, x, y) => (
        this.crimeController.recordPoliceFootTactic(officerId, 'arrest', x, y)
      )
    });
    this.pedestrians = new PedestrianController({
      state: this.state,
      world: this.world,
      random: this.random,
      clock: () => ({tick: this.simulationClock.tick}),
      events: this.events,
      stimuli: this.worldStimuli,
      policeTarget: (officer, nowMs) => this.crimeController.policeTarget(officer, nowMs),
      requestPoliceArrest: (officerId, suspectId, nowMs) => (
        this.policeArrests.request(officerId, suspectId, nowMs)
      ),
      isPoliceArresting: (officerId) => this.policeArrests.holdsOfficer(officerId),
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
    this.policeStingers = new PoliceStingerController({
      state: this.state,
      roadblocks: () => this.policeRoadblocks.activeDeployments(),
      pedestrians: this.pedestrians,
      closures: this.roadClosures,
      events: this.events,
      clock: () => ({tick: this.simulationClock.tick})
    });
    this.population = new DistrictPopulationController({
      state: this.state,
      world: this.world,
      pedestrians: this.pedestrians,
      traffic: this.trafficController,
      includeAmbientPedestrians: false,
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
      worldMinute: () => worldMinuteAt(this.state, this.epochMs + this.simulationClock.nowMs),
      onVehicleMaterialized: (vehicle) => this.indexVehicle(vehicle),
      onVehicleDematerialized: (vehicleId) => this.spatialIndex.remove('vehicle', vehicleId)
    });
    this.projectileController = new ProjectileController({
      state: this.state,
      world: this.world,
      access: this.vehicleAccess,
      vehicles: this.vehicleSimulation,
      damage: this.damageController,
      history: this.combatHistory,
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
    this.combatFireCommands = new CombatFireCommandController({
      state: this.state,
      fire: (playerId, command) => this.fireControl.shoot(playerId, command)
    });
    this.rocketProjectileController = new RocketProjectileController({
      state: this.state,
      world: this.world,
      queryPlayers: (minX, minY, maxX, maxY) => this.spatialIndex.queryAabb(
        minX, minY, maxX, maxY, {kinds: ['player']}
      ).map((record) => this.state.players.get(record.id))
        .filter((player): player is PlayerState => Boolean(player)),
      queryNpcs: (minX, minY, maxX, maxY) => this.spatialIndex.queryAabb(
        minX, minY, maxX, maxY, {kinds: ['npc']}
      ).map((record) => this.state.npcs.get(record.id))
        .filter((npc): npc is NpcState => Boolean(npc)),
      queryVehicles: (minX, minY, maxX, maxY) => this.spatialIndex.queryAabb(
        minX, minY, maxX, maxY, {kinds: ['vehicle']}
      ).map((record) => this.state.vehicles.get(record.id))
        .filter((vehicle): vehicle is VehicleState => Boolean(vehicle)),
      detonate: (x, y, ownerId, nowMs, surfaceId) => {
        this.explosionController.detonate(
          'rocket', x, y, ownerId, 'player', nowMs, surfaceId
        );
      },
      remove: (rocketId) => this.lifecycle.defer(`rocket.remove:${rocketId}`, () => {
        this.state.rockets.delete(rocketId);
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
    this.simulation = new DistrictSimulation({
      state: this.state,
      clock: this.simulationClock,
      populationStreaming: this.populationStreaming,
      trafficSignals: this.trafficSignalController,
      explosions: this.explosionController,
      policeFleet: this.policeResponseFleet,
      policeRoadblocks: this.policeRoadblocks,
      policeStingers: this.policeStingers,
      vehicles: this.vehicleSimulation,
      reactions: this.combatReactions,
      melee: this.meleeCombat,
      playerLifecycle: this.playerLifecycle,
      playerControl: this.playerControl,
      vehicleAccess: this.vehicleAccess,
      crime: this.crimeController,
      policeArrests: this.policeArrests,
      pedestrians: this.pedestrians,
      worldStimuli: this.worldStimuli,
      worldStimulusAdapter: this.worldStimulusAdapter,
      combatHistory: this.combatHistory,
      bullets: this.projectileController,
      rockets: this.rocketProjectileController,
      thrownProjectiles: this.thrownProjectileController,
      fireZones: this.fireZoneController,
      actorBurn: this.actorBurnController,
      weaponPickups: this.weaponPickupController,
      cashPickups: this.cashPickupController,
      missions: this.missionController,
      lifecycle: this.lifecycle,
      events: this.events,
      audio: this.audioEvents,
      debug: this.debugProjection,
      journal: this.journal,
      indexPlayer: (player) => this.indexPlayer(player),
      indexNpc: (npc) => this.indexNpc(npc),
      indexVehicle: (vehicle) => this.indexVehicle(vehicle)
    });
    this.serviceController.initialize();
    this.medicalController.initialize();
    this.weaponPickupController.initialize();
    this.trafficSignalController.initialize(this.simulationClock.nowMs);
    this.population.populate();
    this.populationStreaming.initialize(this.simulationClock.nowMs);
    this.rebuildSpatialIndex();
    if (!options?.externalSimulation) {
      this.setSimulationInterval(
        (deltaTime) => {
          this.simulation.advance(deltaTime);
          this.voiceChat.synchronize();
        },
        this.simulationClock.stepMs
      );
    }

    this.registerJournaledCommand<PlayerMoveInput>('input', (client, message) => {
      this.playerControl.setMove(client.sessionId, message);
    });
    this.registerJournaledCommand<OnFootInputBatchMessage>(ON_FOOT_INPUT_MESSAGE, (client, message) => {
      this.playerControl.acceptBatch(client.sessionId, message);
    });
    this.registerJournaledCommand<VehicleInputBatchMessage>(VEHICLE_INPUT_MESSAGE, (client, message) => {
      this.vehicleInput.accept(client.sessionId, message);
    });
    this.onMessage<NetworkPingMessage>(NETWORK_PING_MESSAGE, (client, message) => {
      const response = this.networkProbe.accept(
        client.sessionId,
        message,
        this.simulationClock.nowMs,
        this.simulationClock.tick
      );
      if (response) client.send(NETWORK_PONG_MESSAGE, response);
    });
    this.onMessage<NetcodeRolloutRequest>(NETCODE_ROLLOUT_REQUEST_MESSAGE, (client, message) => {
      if (!validateNetcodeRolloutRequest(message)) return;
      client.send(NETCODE_ROLLOUT_MANIFEST_MESSAGE, this.netcodeRollout);
    });
    this.onMessage(VOICE_TOKEN_REQUEST_MESSAGE, (client) => {
      void this.voiceChat.issueToken(client.sessionId);
    });

    this.registerJournaledCommand<PlayerAimInput>('aim', (client, message) => {
      this.playerControl.setAim(client.sessionId, message);
    });

    this.registerJournaledCommand<CombatFireCommand>(COMBAT_FIRE_MESSAGE, (client, message) => {
      if (this.netcodeRollout.stages.combatRewind) {
        this.combatFireCommands.accept(client.sessionId, message);
      } else {
        const player = this.state.players.get(client.sessionId);
        if (player?.spaceId === 'street') this.fireControl.shoot(client.sessionId);
      }
    });
    this.registerJournaledCommand('shoot', (client) => {
      const player = this.state.players.get(client.sessionId);
      if (player?.spaceId === 'street') this.fireControl.shoot(client.sessionId);
    });
    this.registerJournaledCommand<CycleWeaponMessage>('cycleWeapon', (client, message) => {
      this.fireControl.cycle(client.sessionId, message?.direction);
    });
    this.registerJournaledCommand<RadioStationMessage>(RADIO_STATION_MESSAGE, (client, message) => {
      const player = this.state.players.get(client.sessionId);
      const vehicle = player?.vehicleId ? this.state.vehicles.get(player.vehicleId) : undefined;
      const stationId = message?.stationId ?? '';
      if (!player?.alive || !vehicle || !RADIO_STATION_IDS.has(stationId)) return;
      vehicle.radioStation = stationId;
    });
    this.registerJournaledCommand<AppearanceUpdateMessage>(APPEARANCE_UPDATE_MESSAGE, (client, message) => {
      const status = this.appearanceController.update(client.sessionId, message);
      client.send(APPEARANCE_RESULT_MESSAGE, {status});
    });
    this.onMessage<PlayerSpawnMessage>(PLAYER_SPAWN_MESSAGE, (client, message) => {
      void this.spawnPlayerWithAuth(client, {
        name: message?.name,
        appearance: message?.appearance,
        auth: message?.auth
      });
    });
    this.onMessage(WARDROBE_REQUEST_MESSAGE, (client) => sendWardrobeState(client.sessionId));
    this.registerJournaledCommand<MedicalCareMessage>(MEDICAL_CARE_MESSAGE, (client, message) => {
      if (!isMedicalCareKind(message?.kind)) return;
      this.medicalController.select(client.sessionId, message.kind, this.simulationClock.nowMs);
    });
    this.registerJournaledCommand('interact', (client) => {
      this.interactionController.interact(
        client.sessionId,
        this.simulationClock.nowMs,
        this.simulationClock.tick
      );
    });
    this.registerJournaledCommand<MissionStartMessage>(MISSION_START_MESSAGE, (client, message) => {
      this.missionController.start(client.sessionId, message?.templateId);
    });
    this.registerJournaledCommand<MissionIdMessage>(MISSION_JOIN_MESSAGE, (client, message) => {
      this.missionController.join(client.sessionId, message?.missionId);
    });
    this.registerJournaledCommand<MissionIdMessage>(MISSION_LAUNCH_MESSAGE, (client, message) => {
      this.missionController.launch(client.sessionId, message?.missionId);
    });
    this.registerJournaledCommand<MissionIdMessage>(MISSION_ABANDON_MESSAGE, (client, message) => {
      this.missionController.abandon(client.sessionId, message?.missionId);
    });
    this.onMessage(DEBUG_SUBSCRIBE_MESSAGE, (client) => {
      this.debugSubscribers.add(client.sessionId);
    });
    this.onMessage(DEBUG_UNSUBSCRIBE_MESSAGE, (client) => {
      this.debugSubscribers.delete(client.sessionId);
    });
  }

  onJoin(client: Client, options: DistrictJoinOptions = {}): void {
    if (options.spectator) {
      client.view = this.replicationController.attach(client.sessionId, {
        ...this.world.spawnFor(this.state.players.size, PLAYER_RADIUS),
        spaceId: 'street'
      });
      return;
    }
    void this.spawnPlayerWithAuth(client, options);
  }

  private async spawnPlayerWithAuth(
    client: Client,
    options: {name?: string; appearance?: unknown; auth?: ClientAuthPayload} = {}
  ): Promise<void> {
    if (this.state.players.has(client.sessionId)) return;
    const identity = await verifyClientAuth(options.auth);
    this.authIdentities.set(client.sessionId, identity);
    this.spawnPlayer(client, options);
  }

  private spawnPlayer(client: Client, options: {name?: string; appearance?: unknown} = {}): void {
    if (this.state.players.has(client.sessionId)) return;
    const spawn = this.world.spawnFor(this.state.players.size, PLAYER_RADIUS);
    const player = new PlayerState();
    player.id = client.sessionId;
    player.armor = 25;
    player.name = sanitizeName(options?.name, this.state.players.size + 1);
    player.x = spawn.x;
    player.y = spawn.y;
    player.surfaceId = spawn.surfaceId;
    player.angle = -Math.PI / 2;
    this.wardrobeController.initialize(client.sessionId);
    this.appearanceController.initialize(player, options?.appearance);
    this.state.players.set(client.sessionId, player);
    client.view = this.replicationController.attach(client.sessionId);
    this.playerControl.register(client.sessionId);
    this.indexPlayer(player);
    this.journal?.recordSpawn(this.simulationClock.tick, client.sessionId, {
      name: options?.name,
      appearance: options?.appearance
    });
  }

  onLeave(client: Client): void {
    if (this.state.players.has(client.sessionId)) {
      this.journal?.recordLeave(this.simulationClock.tick, client.sessionId);
    }
    this.replicationController.detach(client.sessionId);
    this.debugSubscribers.delete(client.sessionId);
    this.networkProbe.clear(client.sessionId);
    this.authIdentities.delete(client.sessionId);
    this.voiceChat.clearPlayer(client.sessionId);
    const player = this.state.players.get(client.sessionId);
    this.policeArrests.clearPlayer(client.sessionId, this.simulationClock.nowMs);
    if (player) this.vehicleAccess.removePlayer(player);
    this.state.players.delete(client.sessionId);
    this.playerControl.unregister(client.sessionId);
    this.vehicleInput.clear(client.sessionId);
    this.playerLifecycle.clearPlayer(client.sessionId);
    this.appearanceController.clearPlayer(client.sessionId);
    this.wardrobeController.clearPlayer(client.sessionId);
    this.medicalController.clearPlayer(client.sessionId);
    this.interactionController.clearPlayer(client.sessionId);
    this.fireControl.clearPlayer(client.sessionId);
    this.combatFireCommands.clearPlayer(client.sessionId);
    this.meleeCombat.clearPlayer(client.sessionId);
    this.combatReactions.clearPlayer(client.sessionId);
    this.crimeController.clearSuspect(client.sessionId);
    this.spatialIndex.remove('player', client.sessionId);
  }

  onDispose(): void {
    this.journal?.close();
    this.physicsWorld?.free();
  }

  private registerJournaledCommand<Message = undefined>(
    type: string,
    handler: (client: JournaledCommandClient, message: Message) => void
  ): void {
    this.journaledCommands.set(type, (client, payload) => handler(client, payload as Message));
    this.onMessage(type, (client, message) => this.receiveCommand(type, client, message));
  }

  private receiveCommand(type: string, client: JournaledCommandClient, payload: unknown): void {
    this.journal?.recordCommand(this.simulationClock.tick, client.sessionId, type, payload);
    this.journaledCommands.get(type)?.(client, payload);
  }

  applyJournaledCommand(sessionId: string, type: string, payload: unknown): void {
    this.receiveCommand(type, replayClient(sessionId), payload);
  }

  applyJournaledSpawn(sessionId: string, options: {name?: string; appearance?: unknown} = {}): void {
    this.spawnPlayer(replayClient(sessionId) as unknown as Client, options);
  }

  applyJournaledLeave(sessionId: string): void {
    this.onLeave(replayClient(sessionId) as unknown as Client);
  }

  get simulationTick(): number {
    return this.simulationClock.tick;
  }

  stepSimulationTick(): void {
    this.simulation.advance(this.simulationClock.stepMs);
    this.voiceChat.synchronize();
  }

  private noticePlayer(
    playerId: string,
    message: string,
    tone: GameNotice['tone']
  ): void {
    const client = this.clients.find((candidate) => candidate.sessionId === playerId);
    client?.send(GAME_NOTICE_MESSAGE, {message, tone} satisfies GameNotice);
  }

  onBeforePatch(): void {
    this.replicationController?.synchronize();
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
    return {
      id: player.id,
      kind: 'player',
      x: player.x,
      y: player.y,
      radius: PLAYER_RADIUS,
      layerId: player.surfaceId
    };
  }

  private npcSpatialRecord(npc: NpcState): SpatialRecord<WorldEntityKind> {
    return {
      id: npc.id,
      kind: 'npc',
      x: npc.x,
      y: npc.y,
      radius: PEDESTRIAN_RADIUS,
      layerId: npc.surfaceId
    };
  }

  private vehicleSpatialRecord(vehicle: VehicleState): SpatialRecord<WorldEntityKind> {
    return {
      id: vehicle.id,
      kind: 'vehicle',
      x: vehicle.x,
      y: vehicle.y,
      radius: VEHICLE_COLLISION_BOUNDING_RADIUS,
      layerId: vehicle.surfaceId
    };
  }

}

function resolveSeed(requested: number | string | undefined): number | string {
  if (typeof requested === 'number' && Number.isFinite(requested)) return requested;
  if (typeof requested === 'string' && requested.trim().length > 0) {
    const numeric = Number(requested);
    return Number.isFinite(numeric) ? numeric : requested.trim();
  }
  return 'industrial-district:v1';
}

function environmentJournalSink(roomId: string | undefined): JournalSink | undefined {
  const directory = process.env.GAME_JOURNAL_DIR?.trim();
  if (!directory) return undefined;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return new FileJournalSink(join(directory, `district-${roomId ?? 'room'}-${stamp}.jsonl`));
}

function replayClient(sessionId: string): JournaledCommandClient {
  return {sessionId, send: () => {}};
}

function sanitizeName(value: unknown, fallbackNumber: number): string {
  const name = String(value ?? '').replace(/[^a-zA-Z0-9 _-]/g, '').trim().slice(0, 18);
  return name || `Driver ${fallbackNumber}`;
}
