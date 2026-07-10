import type {CrimeKind} from '../incidents/crime-policy.ts';
import type {GameEventStream, VehicleDamageSource} from '../events/game-events.ts';
import type {DistrictState, NpcState, PlayerState, VehicleState} from '../../state.ts';
import type {CollisionMap} from '../../world-map.ts';
import type {TrafficController} from '../traffic/traffic-controller.ts';
import type {TrafficObstacle} from '../traffic/traffic-awareness-system.ts';
import type {PoliceVehicleController} from '../police/police-vehicle-controller.ts';
import {classifyImpactZone, VehicleCollisionSystem, type VehicleDamageZone} from './vehicle-collision-system.ts';
import {vehicleConfig} from './vehicle-config.ts';
import {VehicleDamageSystem} from './vehicle-damage-system.ts';
import type {VehicleAccessController} from './vehicle-access-controller.ts';

const PLAYER_RADIUS = 11;
const NPC_RADIUS = 10;
const VEHICLE_RADIUS = 20;
const RESPAWN_DELAY_MS = 8000;

interface DriverInput {
  inputX: number;
  inputY: number;
}

interface SimulationClock {
  tick: number;
}

interface VehicleSimulationControllerOptions {
  state: DistrictState;
  world: CollisionMap;
  events: GameEventStream;
  access: VehicleAccessController;
  traffic: TrafficController;
  policeVehicles?: Pick<PoliceVehicleController, 'has' | 'update'>;
  clock: () => SimulationClock;
  inputFor: (playerId: string) => DriverInput | undefined;
  nearbyPlayers: (x: number, y: number, radius: number) => PlayerState[];
  nearbyNpcs: (x: number, y: number, radius: number) => NpcState[];
  nearbyVehicles: (x: number, y: number, radius: number) => VehicleState[];
  damagePlayer: (
    player: PlayerState,
    damage: number,
    attackerId: string,
    nowMs: number,
    crimeKind?: CrimeKind
  ) => void;
  damageNpc: (
    npc: NpcState,
    damage: number,
    attackerId: string,
    nowMs: number,
    crimeKind?: CrimeKind
  ) => void;
}

export class VehicleSimulationController {
  private readonly collisions = new VehicleCollisionSystem();
  private readonly damageSystem = new VehicleDamageSystem();
  private readonly impactAt = new Map<string, number>();
  private readonly collisionPairsThisTick = new Set<string>();
  private readonly fireSources = new Map<string, {sourceId: string; sourceKind: VehicleDamageSource}>();

  constructor(private readonly options: VehicleSimulationControllerOptions) {}

  beginTick(): void {
    this.collisionPairsThisTick.clear();
  }

  update(vehicle: VehicleState, deltaSeconds: number, nowMs: number): void {
    const configuration = vehicleConfig(vehicle.kind);
    if (!vehicle.destroyed && this.damageSystem.shouldExplode(vehicle, nowMs)) {
      const source = this.fireSources.get(vehicle.id) ?? {sourceId: '', sourceKind: 'world' as const};
      this.destroy(vehicle, source.sourceId, source.sourceKind, nowMs);
    }
    if (vehicle.destroyed) {
      this.updateDestroyed(vehicle, nowMs);
      this.syncOccupants(vehicle);
      return;
    }
    if (
      !vehicle.driverId &&
      this.options.policeVehicles?.has(vehicle.id)
    ) {
      if (this.options.policeVehicles.update(
        vehicle,
        deltaSeconds,
        nowMs,
        this.trafficObstacles(vehicle, configuration.traffic.lookAhead)
      )) {
        this.handleTrafficImpacts(vehicle, nowMs);
      }
      this.handleCollision(vehicle, nowMs);
      this.syncOccupants(vehicle);
      return;
    }
    if (vehicle.traffic && !vehicle.driverId) {
      if (this.options.traffic.update(vehicle, deltaSeconds, nowMs, {
        obstacles: this.trafficObstacles(vehicle, configuration.traffic.lookAhead)
      })) {
        this.handleTrafficImpacts(vehicle, nowMs);
      }
      this.handleCollision(vehicle, nowMs);
      this.syncOccupants(vehicle);
      return;
    }

    const driver = vehicle.driverId ? this.options.state.players.get(vehicle.driverId) : undefined;
    const input = vehicle.driverId ? this.options.inputFor(vehicle.driverId) : undefined;
    if (driver?.alive && input) {
      vehicle.siren = false;
      const throttle = -input.inputY;
      if (throttle !== 0) {
        const changingDirection = vehicle.speed !== 0 && Math.sign(vehicle.speed) !== Math.sign(throttle);
        if (changingDirection) {
          vehicle.speed = approach(
            vehicle.speed,
            0,
            configuration.handling.brakeDeceleration * deltaSeconds
          );
        } else {
          const acceleration = throttle > 0
            ? configuration.handling.forwardAcceleration
            : configuration.handling.reverseAcceleration;
          vehicle.speed += throttle * acceleration * deltaSeconds;
        }
      } else {
        vehicle.speed = approach(
          vehicle.speed,
          0,
          configuration.handling.coastDeceleration * deltaSeconds
        );
      }
      const speedMultiplier = this.damageSystem.speedMultiplier(vehicle.engineDamage, vehicle.onFire);
      vehicle.speed = clamp(
        vehicle.speed,
        -configuration.handling.maximumReverseSpeed * speedMultiplier,
        configuration.handling.maximumForwardSpeed * speedMultiplier
      );

      if (Math.abs(vehicle.speed) > 4 && input.inputX !== 0) {
        const grip = clamp(
          Math.abs(vehicle.speed) / configuration.handling.steeringGripSpeed,
          configuration.handling.steeringGripFloor,
          1
        );
        const direction = vehicle.speed >= 0 ? 1 : -1;
        vehicle.angle = normalizeAngle(
          vehicle.angle + input.inputX * configuration.handling.steeringRate *
            grip * direction * deltaSeconds
        );
      }

      const nextX = vehicle.x + Math.cos(vehicle.angle) * vehicle.speed * deltaSeconds;
      const nextY = vehicle.y + Math.sin(vehicle.angle) * vehicle.speed * deltaSeconds;
      if (this.options.world.canOccupy(nextX, nextY, VEHICLE_RADIUS)) {
        vehicle.x = nextX;
        vehicle.y = nextY;
      } else {
        this.damage(
          vehicle,
          this.damageSystem.wallImpactDamage(vehicle.speed),
          '',
          'world',
          nowMs,
          vehicle.speed >= 0 ? 'front' : 'rear'
        );
        vehicle.speed *= -0.2;
      }
      if (!vehicle.destroyed) this.handleDriverImpacts(vehicle, driver, nowMs);
    } else {
      if (vehicle.driverId) {
        vehicle.driverId = '';
        this.options.access.promotePassenger(vehicle);
      }
      vehicle.speed = approach(vehicle.speed, 0, 220 * deltaSeconds);
    }
    this.handleCollision(vehicle, nowMs);
    this.syncOccupants(vehicle);
  }

  returnToTraffic(vehicle: VehicleState, nowMs: number): void {
    const configuration = vehicleConfig(vehicle.kind);
    for (const occupant of this.options.access.occupants(vehicle.id)) {
      this.options.access.removePlayer(occupant);
    }
    const spawn = this.options.world.trafficSpawn(nowMs + vehicle.id.length * 97, VEHICLE_RADIUS);
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
    for (const other of this.options.nearbyVehicles(vehicle.x, vehicle.y, VEHICLE_RADIUS)) {
      if (other.id === vehicle.id) continue;
      const pairKey = [vehicle.id, other.id].sort().join(':');
      if (this.collisionPairsThisTick.has(pairKey)) continue;
      const vehicleSettings = vehicleConfig(vehicle.kind);
      const otherSettings = vehicleConfig(other.kind);
      const result = this.collisions.resolve({
        id: vehicle.id,
        x: vehicle.x,
        y: vehicle.y,
        angle: vehicle.angle,
        speed: vehicle.speed,
        radius: VEHICLE_RADIUS,
        mass: vehicleSettings.mass * (vehicle.destroyed ? 2.5 : 1),
        damageScale: vehicleSettings.collisionDamageScale
      }, {
        id: other.id,
        x: other.x,
        y: other.y,
        angle: other.angle,
        speed: other.destroyed ? 0 : other.speed,
        radius: VEHICLE_RADIUS,
        mass: otherSettings.mass * (other.destroyed ? 2.5 : 1),
        damageScale: otherSettings.collisionDamageScale
      });
      if (!result.collided) continue;
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
      this.syncOccupants(other);
      return;
    }
  }

  weaponDamage(baseDamage: number): number {
    return this.damageSystem.weaponDamage(baseDamage);
  }

  repair(vehicle: VehicleState): void {
    Object.assign(vehicle, this.damageSystem.reset(vehicleConfig(vehicle.kind).maxHealth));
    this.fireSources.delete(vehicle.id);
  }

  private trafficObstacles(vehicle: VehicleState, lookAhead: number): TrafficObstacle[] {
    const vehicles = this.options.nearbyVehicles(vehicle.x, vehicle.y, lookAhead)
      .filter((candidate) => candidate.id !== vehicle.id && !candidate.destroyed)
      .map((candidate): TrafficObstacle => ({
        id: candidate.id,
        kind: 'vehicle',
        x: candidate.x,
        y: candidate.y,
        radius: VEHICLE_RADIUS,
        speed: candidate.speed,
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
    return [...vehicles, ...players, ...npcs];
  }

  private handleTrafficImpacts(vehicle: VehicleState, nowMs: number): void {
    if (vehicle.speed < 70 || nowMs - (this.impactAt.get(vehicle.id) ?? 0) < 600) return;
    for (const player of this.options.nearbyPlayers(vehicle.x, vehicle.y, VEHICLE_RADIUS)) {
      if (!player.alive || player.vehicleId) continue;
      if (Math.hypot(player.x - vehicle.x, player.y - vehicle.y) > VEHICLE_RADIUS + PLAYER_RADIUS) continue;
      this.options.damagePlayer(player, 45, '', nowMs);
      vehicle.speed *= 0.55;
      this.impactAt.set(vehicle.id, nowMs);
      return;
    }
    for (const npc of this.options.nearbyNpcs(vehicle.x, vehicle.y, VEHICLE_RADIUS)) {
      if (!npc.alive) continue;
      if (Math.hypot(npc.x - vehicle.x, npc.y - vehicle.y) > VEHICLE_RADIUS + NPC_RADIUS) continue;
      this.options.damageNpc(npc, 100, '', nowMs);
      vehicle.speed *= 0.62;
      this.impactAt.set(vehicle.id, nowMs);
      return;
    }
  }

  private handleDriverImpacts(vehicle: VehicleState, driver: PlayerState, nowMs: number): void {
    if (Math.abs(vehicle.speed) < 90 || nowMs - (this.impactAt.get(vehicle.id) ?? 0) < 450) return;
    for (const npc of this.options.nearbyNpcs(vehicle.x, vehicle.y, VEHICLE_RADIUS)) {
      if (!npc.alive || Math.hypot(npc.x - vehicle.x, npc.y - vehicle.y) > VEHICLE_RADIUS + NPC_RADIUS) {
        continue;
      }
      this.options.damageNpc(
        npc,
        Math.min(100, Math.round(Math.abs(vehicle.speed) * 0.45)),
        driver.id,
        nowMs,
        npc.kind === 'police' ? 'hit-and-run-police' : 'hit-and-run'
      );
      vehicle.speed *= 0.72;
      this.impactAt.set(vehicle.id, nowMs);
      return;
    }
    for (const player of this.options.nearbyPlayers(vehicle.x, vehicle.y, VEHICLE_RADIUS)) {
      if (!player.alive || player.id === driver.id || player.vehicleId) continue;
      if (Math.hypot(player.x - vehicle.x, player.y - vehicle.y) > VEHICLE_RADIUS + PLAYER_RADIUS) continue;
      this.options.damagePlayer(player, 50, driver.id, nowMs, 'hit-and-run');
      vehicle.speed *= 0.68;
      this.impactAt.set(vehicle.id, nowMs);
      return;
    }
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
      this.options.damagePlayer(occupant, 35, sourceId, nowMs);
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
}

function normalizeAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
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
