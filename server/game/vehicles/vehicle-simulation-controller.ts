import type {CrimeKind} from '../incidents/crime-policy.ts';
import type {GameEventStream, VehicleDamageSource} from '../events/game-events.ts';
import type {DistrictState, NpcState, PlayerState, VehicleState} from '../../state.ts';
import type {CollisionMap} from '../../world-map.ts';
import type {TrafficController} from '../traffic/traffic-controller.ts';
import type {TrafficObstacle} from '../traffic/traffic-awareness-system.ts';
import type {PoliceVehicleController} from '../police/police-vehicle-controller.ts';
import type {TrafficSignalController} from '../traffic/traffic-signal-controller.ts';
import {classifyImpactZone, VehicleCollisionSystem, type VehicleDamageZone} from './vehicle-collision-system.ts';
import {VEHICLE_COLLISION_BOUNDING_RADIUS, vehicleConfig} from './vehicle-config.ts';
import {VehicleDamageSystem} from './vehicle-damage-system.ts';
import type {VehicleAccessController} from './vehicle-access-controller.ts';
import type {DamageImpact} from '../combat/combat-survivability-policy.ts';
import {stepVehicleWithWorldCollision} from '../../../shared/simulation/vehicle-step.ts';
import {
  captureVehicleBody,
  driveVehicleBody
} from '../../../shared/simulation/vehicle-body-drive.ts';
import type {VehicleWorldPose} from '../../../shared/physics/vehicle-world-collision.ts';
import type {PhysicsWorld} from '../../../shared/physics/physics-world.ts';
import {
  VehicleHumanoidContactSystem,
  type VehicleHumanoidContactPhaseResult
} from './vehicle-humanoid-contact-system.ts';

const PLAYER_RADIUS = 11;
const NPC_RADIUS = 10;
const VEHICLE_RADIUS = 20;
const RESPAWN_DELAY_MS = 8000;
const PHYSICS_COST_SAMPLE_LIMIT = 600;

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

interface VehicleSimulationControllerOptions {
  state: DistrictState;
  world: CollisionMap;
  events: GameEventStream;
  access: VehicleAccessController;
  traffic: TrafficController;
  signals?: Pick<TrafficSignalController, 'obstaclesFor'>;
  policeVehicles?: Pick<PoliceVehicleController, 'has' | 'update'>;
  physics?: PhysicsWorld;
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
  private readonly collisions = new VehicleCollisionSystem();
  private readonly humanoidContacts: VehicleHumanoidContactSystem;
  private readonly damageSystem = new VehicleDamageSystem();
  private readonly collisionPairsThisTick = new Set<string>();
  private readonly fireSources = new Map<string, {sourceId: string; sourceKind: VehicleDamageSource}>();
  private readonly pendingPhysicsDrives: PendingPhysicsDrive[] = [];
  private readonly physicsStepCostSamples: number[] = [];

  constructor(private readonly options: VehicleSimulationControllerOptions) {
    this.humanoidContacts = new VehicleHumanoidContactSystem(options);
  }

  beginTick(nowMs = this.options.state.serverTimeMs): void {
    this.collisionPairsThisTick.clear();
    this.humanoidContacts.beginTick();
    this.options.traffic.beginTick(nowMs);
  }

  finishTick(nowMs: number): readonly VehicleState[] {
    const moved = new Map<string, VehicleState>();
    const vehicles = [...this.options.state.vehicles.values()]
      .sort((left, right) => left.id.localeCompare(right.id));
    for (const vehicle of vehicles) {
      for (const other of this.stableCollisionCandidates(vehicle)) {
        if (this.resolveCollisionPair(vehicle, other, nowMs)) {
          moved.set(vehicle.id, vehicle);
          moved.set(other.id, other);
        }
      }
    }
    for (const vehicle of vehicles) this.syncOccupants(vehicle);
    return Object.freeze([...moved.values()]);
  }

  finishHumanoidContacts(
    deltaSeconds: number,
    nowMs: number
  ): VehicleHumanoidContactPhaseResult {
    const result = this.humanoidContacts.resolve(deltaSeconds, nowMs);
    for (const vehicle of result.vehicles) this.syncOccupants(vehicle);
    return result;
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
      if (this.options.physics) {
        this.queuePhysicsDrive(vehicle, driver.id, input, deltaSeconds);
        return;
      }
      const movement = stepVehicleWithWorldCollision(
        {
          x: vehicle.x,
          y: vehicle.y,
          angle: vehicle.angle,
          speed: vehicle.speed
        },
        {steering: input.inputX, throttle: -input.inputY},
        vehicle.kind,
        deltaSeconds,
        (x, y, radius) => this.options.world.canOccupy(x, y, radius),
        this.damageSystem.stepModifiers(
          vehicle.engineDamage,
          vehicle.onFire,
          vehicle.tyreDamageMask
        )
      );
      vehicle.siren = false;
      vehicle.x = movement.pose.x;
      vehicle.y = movement.pose.y;
      vehicle.angle = movement.pose.angle;
      if (movement.collidedWithWorld) {
        this.damage(
          vehicle,
          this.damageSystem.wallImpactDamage(movement.impactSpeed),
          '',
          'world',
          nowMs,
          movement.impactSpeed >= 0 ? 'front' : 'rear'
        );
      }
      vehicle.speed = movement.pose.speed;
      if (input.sequence !== undefined) {
        this.options.acknowledgeInput?.(driver.id, vehicle.id, input.sequence);
      }
    } else {
      if (vehicle.driverId) {
        vehicle.driverId = '';
        this.options.access.promotePassenger(vehicle);
      }
      vehicle.speed = approach(vehicle.speed, 0, 220 * deltaSeconds);
    }
  }

  stepPhysics(nowMs: number): readonly VehicleState[] {
    const physics = this.options.physics;
    if (!physics) return [];
    const driven = new Set(this.pendingPhysicsDrives.map((drive) => drive.vehicle.id));
    for (const key of [...physics.keys()]) {
      if (!driven.has(key)) physics.remove(key);
    }
    if (this.pendingPhysicsDrives.length === 0) return [];

    const startedAt = performance.now();
    physics.step();
    this.physicsStepCostSamples.push(performance.now() - startedAt);
    if (this.physicsStepCostSamples.length > PHYSICS_COST_SAMPLE_LIMIT) {
      this.physicsStepCostSamples.shift();
    }

    const moved: VehicleState[] = [];
    for (const {vehicle, driverId, sequence, desired} of this.pendingPhysicsDrives) {
      const captured = captureVehicleBody(physics, vehicle.id, desired);
      if (!captured) continue;
      vehicle.x = captured.pose.x;
      vehicle.y = captured.pose.y;
      vehicle.angle = captured.pose.angle;
      vehicle.speed = captured.pose.speed;
      if (captured.collidedWithWorld) {
        this.damage(
          vehicle,
          this.damageSystem.wallImpactDamage(captured.impactSpeed),
          '',
          'world',
          nowMs,
          captured.impactSpeed >= 0 ? 'front' : 'rear'
        );
      }
      if (sequence !== undefined) {
        this.options.acknowledgeInput?.(driverId, vehicle.id, sequence);
      }
      moved.push(vehicle);
    }
    this.pendingPhysicsDrives.length = 0;
    return moved;
  }

  physicsStepCosts(): readonly number[] {
    return this.physicsStepCostSamples;
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

  handleCollision(vehicle: VehicleState, nowMs: number): void {
    for (const other of this.collisionCandidates(vehicle)) {
      if (other.id === vehicle.id) continue;
      if (this.resolveCollisionPair(vehicle, other, nowMs)) {
        this.syncOccupants(vehicle);
        this.syncOccupants(other);
      }
    }
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
    const physics = this.options.physics;
    if (!physics || deltaSeconds <= 0) return;
    const desired = driveVehicleBody(
      physics,
      vehicle.id,
      vehicle.kind,
      {x: vehicle.x, y: vehicle.y, angle: vehicle.angle, speed: vehicle.speed},
      {steering: input.inputX, throttle: -input.inputY},
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
      .filter((candidate) => candidate.id !== vehicle.id)
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
      .filter((candidate) => candidate.alive && !candidate.vehicleId)
      .map((candidate): TrafficObstacle => ({
        id: `player:${candidate.id}`,
        kind: 'pedestrian',
        x: candidate.x,
        y: candidate.y,
        radius: PLAYER_RADIUS
      }));
    const npcs = this.options.nearbyNpcs(vehicle.x, vehicle.y, lookAhead)
      .filter((candidate) => candidate.alive)
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
      if (player.vehicleSeat === 0) player.angle = vehicle.angle;
    }
  }

  private stableCollisionCandidates(vehicle: VehicleState): VehicleState[] {
    return this.collisionCandidates(vehicle)
      .filter((other) => other.id.localeCompare(vehicle.id) > 0);
  }

  private collisionCandidates(vehicle: VehicleState): VehicleState[] {
    return this.options.nearbyVehicles(
      vehicle.x,
      vehicle.y,
      VEHICLE_COLLISION_BOUNDING_RADIUS
    ).sort((left, right) => left.id.localeCompare(right.id));
  }

  private resolveCollisionPair(
    vehicle: VehicleState,
    other: VehicleState,
    nowMs: number
  ): boolean {
    const pairKey = [vehicle.id, other.id].sort().join(':');
    if (this.collisionPairsThisTick.has(pairKey)) return false;
    const vehicleSettings = vehicleConfig(vehicle.kind);
    const otherSettings = vehicleConfig(other.kind);
    const result = this.collisions.resolve({
      id: vehicle.id,
      x: vehicle.x,
      y: vehicle.y,
      angle: vehicle.angle,
      speed: vehicle.destroyed ? 0 : vehicle.speed,
      halfLength: vehicleSettings.collision.length / 2,
      halfWidth: vehicleSettings.collision.width / 2,
      mass: vehicleSettings.mass * (vehicle.destroyed ? 2.5 : 1),
      damageScale: vehicleSettings.collisionDamageScale
    }, {
      id: other.id,
      x: other.x,
      y: other.y,
      angle: other.angle,
      speed: other.destroyed ? 0 : other.speed,
      halfLength: otherSettings.collision.length / 2,
      halfWidth: otherSettings.collision.width / 2,
      mass: otherSettings.mass * (other.destroyed ? 2.5 : 1),
      damageScale: otherSettings.collisionDamageScale
    });
    if (!result.collided) return false;
    this.collisionPairsThisTick.add(pairKey);
    if (this.options.world.canOccupy(result.primaryX, result.primaryY, VEHICLE_RADIUS)) {
      vehicle.x = result.primaryX;
      vehicle.y = result.primaryY;
    }
    if (this.options.world.canOccupy(result.otherX, result.otherY, VEHICLE_RADIUS)) {
      other.x = result.otherX;
      other.y = result.otherY;
    }
    if (!vehicle.destroyed) vehicle.speed = clamp(result.primarySpeed, -150, 430);
    if (!other.destroyed) other.speed = clamp(result.otherSpeed, -150, 430);
    this.damage(vehicle, result.primaryDamage, other.driverId, 'vehicle', nowMs, result.primaryZone);
    this.damage(other, result.otherDamage, vehicle.driverId, 'vehicle', nowMs, result.otherZone);
    return true;
  }
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
