import type {CrimeKind} from '../incidents/crime-policy.ts';
import type {GameEventStream, VehicleDamageSource} from '../events/game-events.ts';
import type {DistrictState, NpcState, PlayerState, VehicleState} from '../../state.ts';
import type {CollisionMap} from '../../world-map.ts';
import type {TrafficController} from '../traffic/traffic-controller.ts';
import type {TrafficObstacle} from '../traffic/traffic-awareness-system.ts';
import type {PoliceVehicleController} from '../police/police-vehicle-controller.ts';
import type {TrafficSignalController} from '../traffic/traffic-signal-controller.ts';
import {vehicleConfig} from './vehicle-config.ts';
import {
  classifyImpactZone,
  VehicleDamageSystem,
  type VehicleDamageZone
} from './vehicle-damage-system.ts';
import type {VehicleAccessController} from './vehicle-access-controller.ts';
import type {DamageImpact} from '../combat/combat-survivability-policy.ts';
import {
  captureVehicleBody,
  planVehicleBodyDrive
} from '../../../shared/simulation/vehicle-body-drive.ts';
import type {VehicleWorldPose} from '../../../shared/simulation/vehicle-step.ts';
import type {PhysicsBodyState, PhysicsContact, PhysicsWorld} from '../../../shared/physics/physics-world.ts';
import {
  driveHumanoidBody,
  physicsBodyKey
} from '../../../shared/simulation/humanoid-body-drive.ts';

const PLAYER_RADIUS = 11;
const NPC_RADIUS = 10;
const VEHICLE_RADIUS = 20;
const RESPAWN_DELAY_MS = 8000;
const PHYSICS_COST_SAMPLE_LIMIT = 600;
const TRAFFIC_IMPACT_COOLDOWN_MS = 600;
const DRIVER_IMPACT_COOLDOWN_MS = 450;
const IMPACT_RECORD_RETENTION_MS = 5_000;
const TRAFFIC_HUMANOID_IMPACT_THRESHOLD = 70;
const DRIVER_HUMANOID_IMPACT_THRESHOLD = 90;

function vehicleObstacleDimensions(kind: string): Pick<TrafficObstacle, 'halfLength' | 'halfWidth'> {
  const collision = vehicleConfig(kind).collision;
  return {halfLength: collision.length / 2, halfWidth: collision.width / 2};
}

interface DriverInput {
  inputX: number;
  inputY: number;
  sequence?: number;
}

interface SimulationClock {
  tick: number;
}

interface PendingPhysicsDrive {
  vehicle: VehicleState;
  driverId: string;
  sequence?: number;
  desired: VehicleWorldPose;
}

interface PhysicsAttempt extends PhysicsBodyState {
  readonly key: string;
  readonly kind: 'vehicle' | 'player' | 'pedestrian';
  readonly id: string;
}

interface VehicleSimulationControllerOptions {
  state: DistrictState;
  world: CollisionMap;
  events: GameEventStream;
  access: VehicleAccessController;
  traffic: TrafficController;
  signals?: Pick<TrafficSignalController, 'obstaclesFor'>;
  policeVehicles?: Pick<PoliceVehicleController, 'has' | 'update'>;
  physics: PhysicsWorld;
  clock: () => SimulationClock;
  inputFor: (playerId: string) => DriverInput | undefined;
  acknowledgeInput?: (playerId: string, vehicleId: string, sequence: number) => void;
  nearbyPlayers: (x: number, y: number, radius: number) => PlayerState[];
  nearbyNpcs: (x: number, y: number, radius: number) => NpcState[];
  nearbyVehicles: (x: number, y: number, radius: number) => VehicleState[];
  damagePlayer: (
    player: PlayerState,
    damage: number,
    attackerId: string,
    nowMs: number,
    crimeKind?: CrimeKind,
    impact?: DamageImpact
  ) => void;
  damageNpc: (
    npc: NpcState,
    damage: number,
    attackerId: string,
    nowMs: number,
    crimeKind?: CrimeKind,
    impact?: DamageImpact
  ) => void;
}

export class VehicleSimulationController {
  private readonly damageSystem = new VehicleDamageSystem();
  private readonly fireSources = new Map<string, {sourceId: string; sourceKind: VehicleDamageSource}>();
  private readonly pendingPhysicsDrives: PendingPhysicsDrive[] = [];
  private readonly physicsStepCostSamples: number[] = [];
  private readonly previousBodies = new Map<
    string,
    {x: number; y: number; angle: number; surfaceId: string}
  >();
  private readonly impactAt = new Map<string, number>();
  private readonly physicsBySurface = new Map<string, PhysicsWorld>();

  constructor(private readonly options: VehicleSimulationControllerOptions) {}

  beginTick(nowMs = this.options.state.serverTimeMs): void {
    this.previousBodies.clear();
    for (const vehicle of this.options.state.vehicles.values()) {
      this.previousBodies.set(physicsBodyKey('vehicle', vehicle.id), {
          x: vehicle.x,
          y: vehicle.y,
          angle: vehicle.angle,
          surfaceId: vehicle.surfaceId
      });
    }
    for (const player of this.options.state.players.values()) {
      if (player.alive && !player.vehicleId && player.spaceId === 'street') {
        this.previousBodies.set(physicsBodyKey('player', player.id), {
          x: player.x,
          y: player.y,
          angle: player.angle,
          surfaceId: player.surfaceId
        });
      }
    }
    for (const npc of this.options.state.npcs.values()) {
      if (npc.alive) {
        this.previousBodies.set(physicsBodyKey('pedestrian', npc.id), {
          x: npc.x,
          y: npc.y,
          angle: npc.angle,
          surfaceId: npc.surfaceId
        });
      }
    }
    this.options.traffic.beginTick(nowMs);
  }

  update(vehicle: VehicleState, deltaSeconds: number, nowMs: number): void {
    const configuration = vehicleConfig(vehicle.kind);
    if (!vehicle.destroyed && this.damageSystem.shouldExplode(vehicle, nowMs)) {
      const source = this.fireSources.get(vehicle.id) ?? {sourceId: '', sourceKind: 'world' as const};
      this.destroy(vehicle, source.sourceId, source.sourceKind, nowMs);
    }
    if (vehicle.destroyed) {
      this.updateDestroyed(vehicle, nowMs);
      return;
    }
    if (
      !vehicle.driverId &&
      this.options.policeVehicles?.has(vehicle.id)
    ) {
      this.options.policeVehicles.update(
        vehicle,
        deltaSeconds,
        nowMs,
        this.trafficObstacles(vehicle, configuration.traffic.lookAhead, nowMs, true)
      );
      return;
    }
    if (vehicle.traffic && !vehicle.driverId) {
      const obstacles = this.trafficObstacles(vehicle, configuration.traffic.lookAhead, nowMs);
      this.options.traffic.update(vehicle, deltaSeconds, nowMs, {
        obstacles,
        emergencyVehicles: this.options.nearbyVehicles(
          vehicle.x,
          vehicle.y,
          Math.max(340, configuration.traffic.lookAhead)
        ).filter((candidate) => candidate.siren && !candidate.destroyed)
      });
      this.options.traffic.observe(vehicle, nowMs, obstacles);
      return;
    }

    const driver = vehicle.driverId ? this.options.state.players.get(vehicle.driverId) : undefined;
    const input = vehicle.driverId ? this.options.inputFor(vehicle.driverId) : undefined;
    if (driver?.alive && input) {
      this.queuePhysicsDrive(vehicle, driver.id, input, deltaSeconds);
    } else {
      if (vehicle.driverId) {
        vehicle.driverId = '';
        this.options.access.promotePassenger(vehicle);
      }
      vehicle.speed = approach(vehicle.speed, 0, 220 * deltaSeconds);
    }
  }

  stepPhysics(deltaSeconds: number, nowMs: number) {
    const startedAt = performance.now();
    const actorsBySurface = new Map<string, {
      vehicles: VehicleState[];
      players: PlayerState[];
      npcs: NpcState[];
    }>();
    const actorsFor = (surfaceId: string) => {
      let actors = actorsBySurface.get(surfaceId);
      if (!actors) {
        actors = {vehicles: [], players: [], npcs: []};
        actorsBySurface.set(surfaceId, actors);
      }
      return actors;
    };
    for (const vehicle of this.options.state.vehicles.values()) {
      actorsFor(vehicle.surfaceId).vehicles.push(vehicle);
    }
    for (const player of this.options.state.players.values()) {
      if (player.alive && !player.vehicleId && player.spaceId === 'street') {
        actorsFor(player.surfaceId).players.push(player);
      }
    }
    for (const npc of this.options.state.npcs.values()) {
      if (npc.alive) {
        actorsFor(npc.surfaceId).npcs.push(npc);
      }
    }
    for (const physics of this.physicsBySurface.values()) {
      for (const key of [...physics.keys()]) physics.remove(key);
    }
    this.pruneImpactRecords(nowMs);
    const pending = new Map(this.pendingPhysicsDrives.map((drive) => [drive.vehicle.id, drive]));
    const results = [...actorsBySurface].sort(([left], [right]) => left.localeCompare(right))
      .map(([surfaceId, actors]) => (
      this.stepSurfacePhysics(surfaceId, actors, pending, deltaSeconds, nowMs)
    ));
    this.physicsStepCostSamples.push(performance.now() - startedAt);
    if (this.physicsStepCostSamples.length > PHYSICS_COST_SAMPLE_LIMIT) {
      this.physicsStepCostSamples.shift();
    }
    this.pendingPhysicsDrives.length = 0;
    return Object.freeze({
      vehicles: Object.freeze(results.flatMap((result) => result.vehicles)),
      players: Object.freeze(results.flatMap((result) => result.players)),
      npcs: Object.freeze(results.flatMap((result) => result.npcs)),
      contacts: results.reduce((sum, result) => sum + result.contacts, 0),
      damagingContacts: results.reduce((sum, result) => sum + result.damagingContacts, 0)
    });
  }

  private stepSurfacePhysics(
    surfaceId: string,
    actors: {vehicles: VehicleState[]; players: PlayerState[]; npcs: NpcState[]},
    pending: ReadonlyMap<string, PendingPhysicsDrive>,
    deltaSeconds: number,
    nowMs: number
  ) {
    const physics = this.physicsForSurface(surfaceId);
    const attempts = new Map<string, PhysicsAttempt>();
    const delta = Math.max(0.001, deltaSeconds);

    const vehicles = actors.vehicles.sort((left, right) => left.id.localeCompare(right.id));
    for (const vehicle of vehicles) {
      const key = physicsBodyKey('vehicle', vehicle.id);
      const previous = this.previousBodies.get(key) ?? vehicle;
      const desired = pending.get(vehicle.id)?.desired ?? {
        x: vehicle.x,
        y: vehicle.y,
        angle: vehicle.angle,
        speed: vehicle.destroyed ? 0 : vehicle.speed
      };
      const state = {
        x: previous.x,
        y: previous.y,
        rotation: desired.angle,
        linvelX: (desired.x - previous.x) / delta,
        linvelY: (desired.y - previous.y) / delta,
        angvel: 0
      };
      physics.registerVehicle(key, vehicle.kind, state);
      attempts.set(key, {key, kind: 'vehicle', id: vehicle.id, ...state});
    }

    const players = actors.players.sort((left, right) => left.id.localeCompare(right.id));
    for (const player of players) {
      const key = physicsBodyKey('player', player.id);
      const previous = this.previousBodies.get(key) ?? player;
      const desired = {x: player.x, y: player.y, spaceId: player.spaceId};
      const state = {
        x: previous.x,
        y: previous.y,
        rotation: 0,
        linvelX: (desired.x - previous.x) / delta,
        linvelY: (desired.y - previous.y) / delta,
        angvel: 0
      };
      driveHumanoidBody(
        physics, key, PLAYER_RADIUS,
        {x: previous.x, y: previous.y, spaceId: player.spaceId}, desired, delta
      );
      attempts.set(key, {
        key,
        kind: 'player',
        id: player.id,
        x: previous.x,
        y: previous.y,
        rotation: 0,
        linvelX: (desired.x - previous.x) / delta,
        linvelY: (desired.y - previous.y) / delta,
        angvel: 0
      });
    }

    const npcs = actors.npcs.sort((left, right) => left.id.localeCompare(right.id));
    for (const npc of npcs) {
      const key = physicsBodyKey('pedestrian', npc.id);
      const previous = this.previousBodies.get(key) ?? npc;
      const desired = {x: npc.x, y: npc.y, spaceId: 'street'};
      const state = {
        x: previous.x,
        y: previous.y,
        rotation: 0,
        linvelX: (desired.x - previous.x) / delta,
        linvelY: (desired.y - previous.y) / delta,
        angvel: 0
      };
      driveHumanoidBody(
        physics, key, NPC_RADIUS,
        {x: previous.x, y: previous.y, spaceId: 'street'}, desired, delta
      );
      attempts.set(key, {
        key,
        kind: 'pedestrian',
        id: npc.id,
        x: previous.x,
        y: previous.y,
        rotation: 0,
        linvelX: (desired.x - previous.x) / delta,
        linvelY: (desired.y - previous.y) / delta,
        angvel: 0
      });
    }

    physics.step();

    const movedVehicles: VehicleState[] = [];
    for (const vehicle of vehicles) {
      const previous = this.previousBodies.get(physicsBodyKey('vehicle', vehicle.id)) ?? vehicle;
      const drive = pending.get(vehicle.id);
      const desired = drive?.desired ?? {
        x: vehicle.x,
        y: vehicle.y,
        angle: vehicle.angle,
        speed: vehicle.destroyed ? 0 : vehicle.speed
      };
      const captured = captureVehicleBody(
        physics,
        physicsBodyKey('vehicle', vehicle.id),
        desired
      );
      if (!captured) continue;
      const surfaceAfterMove = this.options.world.surfaceAfterMove;
      const capturedSurfaceId = typeof surfaceAfterMove === 'function'
        ? surfaceAfterMove.call(
          this.options.world,
          previous.surfaceId,
          previous.x,
          previous.y,
          captured.pose.x,
          captured.pose.y,
          VEHICLE_RADIUS,
          'vehicle'
        )
        : vehicle.surfaceId;
      if (!capturedSurfaceId) {
        vehicle.x = previous.x;
        vehicle.y = previous.y;
        vehicle.speed = 0;
        continue;
      }
      vehicle.x = captured.pose.x;
      vehicle.y = captured.pose.y;
      vehicle.surfaceId = capturedSurfaceId;
      vehicle.angle = captured.pose.angle;
      vehicle.speed = captured.pose.speed;
      if (drive && captured.collidedWithWorld) {
        this.damage(
          vehicle,
          this.damageSystem.wallImpactDamage(captured.impactSpeed),
          '',
          'world',
          nowMs,
          captured.impactSpeed >= 0 ? 'front' : 'rear'
        );
      }
      if (drive?.sequence !== undefined) {
        this.options.acknowledgeInput?.(drive.driverId, vehicle.id, drive.sequence);
      }
      this.syncOccupants(vehicle);
      movedVehicles.push(vehicle);
    }

    for (const player of players) {
      const state = physics.capture(physicsBodyKey('player', player.id));
      if (state) {
        player.x = state.x;
        player.y = state.y;
      }
    }
    for (const npc of npcs) {
      const state = physics.capture(physicsBodyKey('pedestrian', npc.id));
      if (state) {
        npc.x = state.x;
        npc.y = state.y;
      }
    }

    let contacts = 0;
    let damagingContacts = 0;
    for (const contact of physics.contacts()) {
      const first = attempts.get(contact.first);
      const second = attempts.get(contact.second);
      if (!first || !second) continue;
      if (first.kind === 'vehicle' && second.kind === 'vehicle') {
        this.applyVehicleContact(first, second, contact, nowMs);
      } else if (first.kind === 'vehicle' || second.kind === 'vehicle') {
        contacts++;
        if (this.applyHumanoidImpact(first, second, contact, nowMs)) damagingContacts++;
      }
    }
    return Object.freeze({
      vehicles: Object.freeze(movedVehicles),
      players: Object.freeze(players),
      npcs: Object.freeze(npcs),
      contacts,
      damagingContacts
    });
  }

  private physicsForSurface(surfaceId: string): PhysicsWorld {
    const existing = this.physicsBySurface.get(surfaceId);
    if (existing) return existing;
    const defaultSurfaceId = this.options.world.surfaces?.manifest.defaultSurfaceId ?? surfaceId;
    const physics = surfaceId === defaultSurfaceId
      ? this.options.physics
      : this.options.physics.fork(false);
    physics.setStaticsEnabled(surfaceId === defaultSurfaceId);
    this.physicsBySurface.set(surfaceId, physics);
    return physics;
  }

  physicsStepCosts(): readonly number[] {
    return this.physicsStepCostSamples;
  }

  private applyVehicleContact(
    first: PhysicsAttempt,
    second: PhysicsAttempt,
    contact: PhysicsContact,
    nowMs: number
  ): void {
    const primary = this.options.state.vehicles.get(first.id);
    const other = this.options.state.vehicles.get(second.id);
    if (!primary || !other) return;
    const closingSpeed = contactSpeed(first, second, contact);
    const baseDamage = Math.max(0, (closingSpeed - 55) * 0.65);
    const primaryConfig = vehicleConfig(primary.kind);
    const otherConfig = vehicleConfig(other.kind);
    const directionX = other.x - primary.x;
    const directionY = other.y - primary.y;
    this.damage(
      primary,
      Math.round(baseDamage * otherConfig.mass * primaryConfig.collisionDamageScale),
      other.driverId,
      'vehicle',
      nowMs,
      classifyImpactZone(primary.angle, directionX, directionY)
    );
    this.damage(
      other,
      Math.round(baseDamage * primaryConfig.mass * otherConfig.collisionDamageScale),
      primary.driverId,
      'vehicle',
      nowMs,
      classifyImpactZone(other.angle, -directionX, -directionY)
    );
  }

  private applyHumanoidImpact(
    first: PhysicsAttempt,
    second: PhysicsAttempt,
    contact: PhysicsContact,
    nowMs: number
  ): boolean {
    const vehicleAttempt = first.kind === 'vehicle' ? first : second;
    const humanoidAttempt = first.kind === 'vehicle' ? second : first;
    const vehicle = this.options.state.vehicles.get(vehicleAttempt.id);
    if (!vehicle || vehicle.destroyed) return false;
    const driver = vehicle.driverId
      ? this.options.state.players.get(vehicle.driverId)
      : undefined;
    const normalDirection = vehicleAttempt === first ? -1 : 1;
    const impactSpeed = Math.max(0, normalDirection * (
      vehicleAttempt.linvelX * contact.normalX +
      vehicleAttempt.linvelY * contact.normalY
    ));
    const threshold = driver?.alive
      ? DRIVER_HUMANOID_IMPACT_THRESHOLD
      : TRAFFIC_HUMANOID_IMPACT_THRESHOLD;
    const cooldown = driver?.alive ? DRIVER_IMPACT_COOLDOWN_MS : TRAFFIC_IMPACT_COOLDOWN_MS;
    const pairKey = `${vehicle.id}|${humanoidAttempt.key}`;
    if (
      impactSpeed < threshold ||
      nowMs - (this.impactAt.get(pairKey) ?? Number.NEGATIVE_INFINITY) < cooldown
    ) return false;

    const attackerId = driver?.id ?? '';
    if (humanoidAttempt.kind === 'player') {
      const player = this.options.state.players.get(humanoidAttempt.id);
      if (!player || player.id === attackerId) return false;
      this.options.damagePlayer(
        player,
        driver?.alive ? 50 : 45,
        attackerId,
        nowMs,
        driver?.alive ? 'hit-and-run' : undefined,
        vehicleImpact(vehicle)
      );
    } else {
      const npc = this.options.state.npcs.get(humanoidAttempt.id);
      if (!npc) return false;
      this.options.damageNpc(
        npc,
        driver?.alive ? Math.min(100, Math.round(impactSpeed * 0.45)) : 100,
        attackerId,
        nowMs,
        driver?.alive
          ? npc.kind === 'police' ? 'hit-and-run-police' : 'hit-and-run'
          : undefined,
        vehicleImpact(vehicle)
      );
    }
    this.impactAt.set(pairKey, nowMs);
    return true;
  }

  private pruneImpactRecords(nowMs: number): void {
    for (const [key, timestamp] of this.impactAt) {
      if (nowMs - timestamp > IMPACT_RECORD_RETENTION_MS) this.impactAt.delete(key);
    }
  }

  returnToTraffic(vehicle: VehicleState, nowMs: number): void {
    const configuration = vehicleConfig(vehicle.kind);
    for (const occupant of this.options.access.occupants(vehicle.id)) {
      this.options.access.removePlayer(occupant);
    }
    const spawn = this.options.traffic.spawn(nowMs + vehicle.id.length * 97, VEHICLE_RADIUS);
    Object.assign(vehicle, this.damageSystem.reset(vehicleConfig(vehicle.kind).maxHealth));
    vehicle.x = spawn.x;
    vehicle.y = spawn.y;
    vehicle.angle = spawn.angle;
    vehicle.speed = 90;
    vehicle.destroyed = false;
    vehicle.respawnAt = 0;
    vehicle.driverId = '';
    vehicle.hijackBy = '';
    vehicle.traffic = true;
    vehicle.siren = false;
    this.fireSources.delete(vehicle.id);
    this.options.traffic.register(vehicle.id, spawn, configuration.traffic.cruiseSpeed);
  }

  damage(
    vehicle: VehicleState,
    amount: number,
    sourceId: string,
    sourceKind: VehicleDamageSource,
    nowMs: number,
    zone: VehicleDamageZone = 'front'
  ): void {
    if (vehicle.destroyed || amount <= 0) return;
    const result = this.damageSystem.apply(vehicle, amount, sourceKind, zone, nowMs);
    if (result.appliedDamage <= 0) return;
    vehicle.health = result.health;
    vehicle.engineDamage = result.engineDamage;
    vehicle.damageFront = result.damageFront;
    vehicle.damageRear = result.damageRear;
    vehicle.damageLeft = result.damageLeft;
    vehicle.damageRight = result.damageRight;
    vehicle.onFire = result.onFire;
    vehicle.fireStartedAt = result.fireStartedAt;
    this.options.events.publish({
      type: 'vehicle.damaged',
      tick: this.options.clock().tick,
      nowMs,
      vehicleId: vehicle.id,
      sourceId,
      sourceKind,
      amount: result.appliedDamage,
      remainingHealth: result.health
    });
    if (result.ignited) {
      this.fireSources.set(vehicle.id, {sourceId, sourceKind});
      this.options.events.publish({
        type: 'vehicle.ignited',
        tick: this.options.clock().tick,
        nowMs,
        vehicleId: vehicle.id,
        sourceId,
        sourceKind,
        explodesAt: result.fireStartedAt + 5000
      });
    }
    if (result.destroyed) this.destroy(vehicle, sourceId, sourceKind, nowMs);
  }

  weaponDamage(baseDamage: number): number {
    return this.damageSystem.weaponDamage(baseDamage);
  }

  repair(vehicle: VehicleState): void {
    Object.assign(vehicle, this.damageSystem.reset(vehicleConfig(vehicle.kind).maxHealth));
    this.fireSources.delete(vehicle.id);
  }

  private queuePhysicsDrive(
    vehicle: VehicleState,
    driverId: string,
    input: DriverInput,
    deltaSeconds: number
  ): void {
    if (deltaSeconds <= 0) return;
    const {desired} = planVehicleBodyDrive(
      {x: vehicle.x, y: vehicle.y, angle: vehicle.angle, speed: vehicle.speed},
      {steering: input.inputX, throttle: -input.inputY},
      vehicle.kind,
      deltaSeconds,
      this.damageSystem.stepModifiers(
        vehicle.engineDamage,
        vehicle.onFire,
        vehicle.tyreDamageMask
      )
    );
    vehicle.siren = false;
    this.pendingPhysicsDrives.push({vehicle, driverId, sequence: input.sequence, desired});
  }

  private trafficObstacles(
    vehicle: VehicleState,
    lookAhead: number,
    nowMs: number,
    emergencyResponse = false
  ): TrafficObstacle[] {
    const vehicles = this.options.nearbyVehicles(vehicle.x, vehicle.y, lookAhead)
      .filter((candidate) => (
        candidate.id !== vehicle.id && this.actorsCanInteract(
          candidate.surfaceId,
          candidate.x,
          candidate.y,
          vehicle.surfaceId,
          vehicle.x,
          vehicle.y,
          'vehicle'
        )
      ))
      .map((candidate): TrafficObstacle => ({
        ...vehicleObstacleDimensions(candidate.kind),
        id: candidate.id,
        kind: 'vehicle',
        x: candidate.x,
        y: candidate.y,
        radius: VEHICLE_RADIUS,
        speed: candidate.destroyed ? 0 : candidate.speed,
        angle: candidate.angle
      }));
    const players = this.options.nearbyPlayers(vehicle.x, vehicle.y, lookAhead)
      .filter((candidate) => (
        candidate.alive && !candidate.vehicleId && this.actorsCanInteract(
          candidate.surfaceId,
          candidate.x,
          candidate.y,
          vehicle.surfaceId,
          vehicle.x,
          vehicle.y,
          'pedestrian'
        )
      ))
      .map((candidate): TrafficObstacle => ({
        id: `player:${candidate.id}`,
        kind: 'pedestrian',
        x: candidate.x,
        y: candidate.y,
        radius: PLAYER_RADIUS
      }));
    const npcs = this.options.nearbyNpcs(vehicle.x, vehicle.y, lookAhead)
      .filter((candidate) => candidate.alive && this.actorsCanInteract(
        candidate.surfaceId,
        candidate.x,
        candidate.y,
        vehicle.surfaceId,
        vehicle.x,
        vehicle.y,
        'pedestrian'
      ))
      .map((candidate): TrafficObstacle => ({
        id: `npc:${candidate.id}`,
        kind: 'pedestrian',
        x: candidate.x,
        y: candidate.y,
        radius: NPC_RADIUS
      }));
    const signals = this.options.signals?.obstaclesFor(vehicle, nowMs, emergencyResponse) ?? [];
    return [...vehicles, ...players, ...npcs, ...signals];
  }

  private actorsCanInteract(
    firstSurfaceId: string,
    firstX: number,
    firstY: number,
    secondSurfaceId: string,
    secondX: number,
    secondY: number,
    actorKind: 'vehicle' | 'pedestrian'
  ): boolean {
    const policy = this.options.world.actorsCanInteract;
    return typeof policy === 'function'
      ? policy.call(
        this.options.world,
        firstSurfaceId,
        firstX,
        firstY,
        secondSurfaceId,
        secondX,
        secondY,
        actorKind
      )
      : firstSurfaceId === secondSurfaceId;
  }

  private destroy(
    vehicle: VehicleState,
    sourceId: string,
    sourceKind: VehicleDamageSource,
    nowMs: number
  ): void {
    vehicle.destroyed = true;
    vehicle.respawnAt = nowMs + RESPAWN_DELAY_MS;
    vehicle.speed = 0;
    vehicle.traffic = false;
    vehicle.hijackBy = '';
    vehicle.onFire = false;
    vehicle.siren = false;
    vehicle.fireStartedAt = 0;
    this.fireSources.delete(vehicle.id);
    const occupants = this.options.access.occupants(vehicle.id);
    vehicle.driverId = '';
    for (let index = 0; index < occupants.length; index++) {
      const occupant = occupants[index];
      const position = this.options.world.openPointNear(
        vehicle.x,
        vehicle.y,
        34,
        82,
        PLAYER_RADIUS,
        nowMs + index * 47 + occupant.id.length
      );
      occupant.vehicleId = '';
      occupant.vehicleSeat = -1;
      occupant.x = position.x;
      occupant.y = position.y;
      this.options.access.clearAction(occupant);
      this.options.damagePlayer(
        occupant,
        35,
        sourceId,
        nowMs,
        undefined,
        {family: 'explosion', force: 'heavy', sourceX: vehicle.x, sourceY: vehicle.y}
      );
    }
    this.options.events.publish({
      type: 'vehicle.destroyed',
      tick: this.options.clock().tick,
      nowMs,
      vehicleId: vehicle.id,
      sourceId,
      sourceKind,
      occupantIds: occupants.map((occupant) => occupant.id)
    });
  }

  private updateDestroyed(vehicle: VehicleState, nowMs: number): void {
    vehicle.speed = 0;
    if (nowMs < vehicle.respawnAt) return;
    const position = this.options.world.openPointNear(
      vehicle.x,
      vehicle.y,
      0,
      96,
      VEHICLE_RADIUS,
      nowMs + vehicle.id.length
    );
    vehicle.x = position.x;
    vehicle.y = position.y;
    Object.assign(vehicle, this.damageSystem.reset(vehicleConfig(vehicle.kind).maxHealth));
    vehicle.destroyed = false;
    vehicle.respawnAt = 0;
    vehicle.traffic = this.options.traffic.has(vehicle.id);
    this.previousBodies.set(physicsBodyKey('vehicle', vehicle.id), {
      x: vehicle.x,
      y: vehicle.y,
      angle: vehicle.angle,
      surfaceId: vehicle.surfaceId
    });
    this.options.events.publish({
      type: 'vehicle.restored',
      tick: this.options.clock().tick,
      nowMs,
      vehicleId: vehicle.id,
      health: vehicle.health
    });
  }

  private syncOccupants(vehicle: VehicleState): void {
    for (const player of this.options.access.occupants(vehicle.id)) {
      player.x = vehicle.x;
      player.y = vehicle.y;
      player.surfaceId = vehicle.surfaceId;
      if (player.vehicleSeat === 0) player.angle = vehicle.angle;
    }
  }

}

function contactSpeed(
  first: PhysicsAttempt,
  second: PhysicsAttempt,
  contact: PhysicsContact
): number {
  return Math.abs(
    (first.linvelX - second.linvelX) * contact.normalX +
    (first.linvelY - second.linvelY) * contact.normalY
  );
}

function vehicleImpact(vehicle: VehicleState): DamageImpact {
  return {
    family: 'vehicle',
    force: 'heavy',
    sourceX: vehicle.x,
    sourceY: vehicle.y
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function approach(value: number, target: number, amount: number): number {
  if (value < target) return Math.min(target, value + amount);
  if (value > target) return Math.max(target, value - amount);
  return value;
}

export {classifyImpactZone};
