import {vehicleDefinition} from '../../../shared/content/vehicle-catalog.ts';
import {resolveVehicleHumanoidContact} from '../../../shared/simulation/vehicle-humanoid-contact.ts';
import {
  DRIVER_HUMANOID_IMPACT_THRESHOLD,
  MAXIMUM_INTERACTION_VEHICLE_SPEED,
  MINIMUM_INTERACTION_VEHICLE_SPEED,
  TRAFFIC_HUMANOID_IMPACT_THRESHOLD,
  VEHICLE_HUMANOID_MASS
} from '../../../shared/simulation/vehicle-humanoid-contact-policy.ts';
import type {CrimeKind} from '../incidents/crime-policy.ts';
import type {DamageImpact} from '../combat/combat-survivability-policy.ts';
import type {CollisionMap} from '../../world-map.ts';
import type {DistrictState, NpcState, PlayerState, VehicleState} from '../../state.ts';
import {VEHICLE_COLLISION_BOUNDING_RADIUS} from './vehicle-config.ts';

const PLAYER_RADIUS = 11;
const NPC_RADIUS = 10;
const TRAFFIC_IMPACT_COOLDOWN_MS = 600;
const DRIVER_IMPACT_COOLDOWN_MS = 450;
const IMPACT_RECORD_RETENTION_MS = 5_000;

interface VehicleHumanoidContactSystemOptions {
  state: DistrictState;
  world: CollisionMap;
  nearbyPlayers: (x: number, y: number, radius: number) => PlayerState[];
  nearbyNpcs: (x: number, y: number, radius: number) => NpcState[];
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

export interface VehicleHumanoidContactPhaseResult {
  readonly vehicles: readonly VehicleState[];
  readonly players: readonly PlayerState[];
  readonly npcs: readonly NpcState[];
  readonly contacts: number;
  readonly damagingContacts: number;
}

interface HumanoidCandidate {
  readonly key: string;
  readonly kind: 'player' | 'npc';
  readonly state: PlayerState | NpcState;
  readonly radius: number;
}

export class VehicleHumanoidContactSystem {
  private previousHumanoids = new Map<string, {x: number; y: number}>();
  private readonly impactAt = new Map<string, number>();

  constructor(private readonly options: VehicleHumanoidContactSystemOptions) {}

  beginTick(): void {
    const previous = new Map<string, {x: number; y: number}>();
    for (const player of this.options.state.players.values()) {
      if (player.alive && !player.vehicleId && player.spaceId === 'street') {
        previous.set(`player:${player.id}`, {x: player.x, y: player.y});
      }
    }
    for (const npc of this.options.state.npcs.values()) {
      if (npc.alive) previous.set(`npc:${npc.id}`, {x: npc.x, y: npc.y});
    }
    this.previousHumanoids = previous;
  }

  resolve(deltaSeconds: number, nowMs: number): VehicleHumanoidContactPhaseResult {
    const movedVehicles = new Map<string, VehicleState>();
    const movedPlayers = new Map<string, PlayerState>();
    const movedNpcs = new Map<string, NpcState>();
    let contacts = 0;
    let damagingContacts = 0;
    this.pruneImpactRecords(nowMs);

    const vehicles = [...this.options.state.vehicles.values()]
      .sort((left, right) => left.id.localeCompare(right.id));
    for (const vehicle of vehicles) {
      for (const humanoid of this.candidatesFor(vehicle)) {
        const previous = this.previousHumanoids.get(humanoid.key);
        const velocityX = previous && deltaSeconds > 0
          ? (humanoid.state.x - previous.x) / deltaSeconds
          : 0;
        const velocityY = previous && deltaSeconds > 0
          ? (humanoid.state.y - previous.y) / deltaSeconds
          : 0;
        const definition = vehicleDefinition(vehicle.kind);
        const result = resolveVehicleHumanoidContact({
          id: vehicle.id,
          x: vehicle.x,
          y: vehicle.y,
          angle: vehicle.angle,
          speed: vehicle.destroyed ? 0 : vehicle.speed,
          halfLength: definition.collision.length / 2,
          halfWidth: definition.collision.width / 2,
          mass: definition.mass * (vehicle.destroyed ? 2.5 : 1)
        }, {
          id: humanoid.key,
          x: humanoid.state.x,
          y: humanoid.state.y,
          velocityX,
          velocityY,
          radius: humanoid.radius,
          mass: VEHICLE_HUMANOID_MASS
        });
        if (!result.valid || !result.collided) continue;
        contacts++;
        if (this.applySeparation(vehicle, humanoid, result)) {
          movedVehicles.set(vehicle.id, vehicle);
          if (humanoid.kind === 'player') {
            movedPlayers.set(humanoid.state.id, humanoid.state as PlayerState);
          } else {
            movedNpcs.set(humanoid.state.id, humanoid.state as NpcState);
          }
        }
        if (!vehicle.destroyed) {
          vehicle.speed = clamp(
            result.vehicleSpeed,
            MINIMUM_INTERACTION_VEHICLE_SPEED,
            MAXIMUM_INTERACTION_VEHICLE_SPEED
          );
        }
        movedVehicles.set(vehicle.id, vehicle);
        if (this.applyImpact(vehicle, humanoid, result.vehicleImpactSpeed, nowMs)) {
          damagingContacts++;
        }
      }
    }

    return Object.freeze({
      vehicles: Object.freeze([...movedVehicles.values()]),
      players: Object.freeze([...movedPlayers.values()]),
      npcs: Object.freeze([...movedNpcs.values()]),
      contacts,
      damagingContacts
    });
  }

  private candidatesFor(vehicle: VehicleState): HumanoidCandidate[] {
    const players = this.options.nearbyPlayers(
      vehicle.x,
      vehicle.y,
      VEHICLE_COLLISION_BOUNDING_RADIUS
    ).filter((player) => player.alive && !player.vehicleId && player.spaceId === 'street')
      .map((state): HumanoidCandidate => ({
        key: `player:${state.id}`,
        kind: 'player',
        state,
        radius: PLAYER_RADIUS
      }));
    const npcs = this.options.nearbyNpcs(
      vehicle.x,
      vehicle.y,
      VEHICLE_COLLISION_BOUNDING_RADIUS
    ).filter((npc) => npc.alive)
      .map((state): HumanoidCandidate => ({
        key: `npc:${state.id}`,
        kind: 'npc',
        state,
        radius: NPC_RADIUS
      }));
    return [...players, ...npcs].sort((left, right) => left.key.localeCompare(right.key));
  }

  private applySeparation(
    vehicle: VehicleState,
    humanoid: HumanoidCandidate,
    result: ReturnType<typeof resolveVehicleHumanoidContact>
  ): boolean {
    const definition = vehicleDefinition(vehicle.kind);
    const vehicleCandidate = {x: result.vehicleX, y: result.vehicleY};
    const humanoidCandidate = {x: result.humanoidX, y: result.humanoidY};
    const vehicleCanMove = this.options.world.canOccupy(
      vehicleCandidate.x,
      vehicleCandidate.y,
      definition.radius
    );
    const humanoidCanMove = this.options.world.canOccupy(
      humanoidCandidate.x,
      humanoidCandidate.y,
      humanoid.radius
    );
    let moved = false;
    if (vehicleCanMove && humanoidCanMove) {
      moved = setPosition(vehicle, vehicleCandidate.x, vehicleCandidate.y) || moved;
      moved = setPosition(humanoid.state, humanoidCandidate.x, humanoidCandidate.y) || moved;
      return moved;
    }
    if (vehicleCanMove) {
      const x = vehicle.x - result.normalX * result.penetration;
      const y = vehicle.y - result.normalY * result.penetration;
      if (this.options.world.canOccupy(x, y, definition.radius)) {
        moved = setPosition(vehicle, x, y) || moved;
      } else {
        moved = setPosition(vehicle, vehicleCandidate.x, vehicleCandidate.y) || moved;
      }
    } else if (humanoidCanMove) {
      const x = humanoid.state.x + result.normalX * result.penetration;
      const y = humanoid.state.y + result.normalY * result.penetration;
      if (this.options.world.canOccupy(x, y, humanoid.radius)) {
        moved = setPosition(humanoid.state, x, y) || moved;
      } else {
        moved = setPosition(humanoid.state, humanoidCandidate.x, humanoidCandidate.y) || moved;
      }
    }
    return moved;
  }

  private applyImpact(
    vehicle: VehicleState,
    humanoid: HumanoidCandidate,
    vehicleImpactSpeed: number,
    nowMs: number
  ): boolean {
    const driver = vehicle.driverId
      ? this.options.state.players.get(vehicle.driverId)
      : undefined;
    const threshold = driver?.alive
      ? DRIVER_HUMANOID_IMPACT_THRESHOLD
      : TRAFFIC_HUMANOID_IMPACT_THRESHOLD;
    const cooldown = driver?.alive ? DRIVER_IMPACT_COOLDOWN_MS : TRAFFIC_IMPACT_COOLDOWN_MS;
    const pairKey = `${vehicle.id}|${humanoid.key}`;
    if (
      vehicleImpactSpeed < threshold ||
      nowMs - (this.impactAt.get(pairKey) ?? Number.NEGATIVE_INFINITY) < cooldown
    ) return false;

    const attackerId = driver?.id ?? '';
    if (humanoid.kind === 'player') {
      if (humanoid.state.id === attackerId) return false;
      this.options.damagePlayer(
        humanoid.state as PlayerState,
        driver?.alive ? 50 : 45,
        attackerId,
        nowMs,
        driver?.alive ? 'hit-and-run' : undefined,
        vehicleImpact(vehicle)
      );
    } else {
      const npc = humanoid.state as NpcState;
      this.options.damageNpc(
        npc,
        driver?.alive ? Math.min(100, Math.round(vehicleImpactSpeed * 0.45)) : 100,
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
}

function vehicleImpact(vehicle: VehicleState): DamageImpact {
  return {
    family: 'vehicle',
    force: 'heavy',
    sourceX: vehicle.x,
    sourceY: vehicle.y
  };
}

function setPosition(
  state: {x: number; y: number},
  x: number,
  y: number
): boolean {
  if (![x, y].every(Number.isFinite) || (state.x === x && state.y === y)) return false;
  state.x = x;
  state.y = y;
  return true;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, Number.isFinite(value) ? value : 0));
}
