import {type Client, Room} from '@colyseus/core';
import {
  DEBUG_SNAPSHOT_MESSAGE,
  type DebugEventEntry,
  type DebugSnapshot
} from '../shared/protocol/debug.ts';
import {GameEventStream, type GameEvent} from './game/events/game-events.ts';
import {DeferredCommandQueue} from './game/world/deferred-command-queue.ts';
import {DeterministicRandom} from './game/world/deterministic-random.ts';
import {FixedStepClock} from './game/world/fixed-step-clock.ts';
import {SpatialIndex, type SpatialRecord} from './game/world/spatial-index.ts';
import {BulletState, DistrictState, NpcState, PlayerState, VehicleState} from './state.ts';
import {
  WEAPON_ORDER,
  WEAPONS,
  ammoFor,
  isWeaponId,
  refillAmmo,
  setAmmo,
  type WeaponId
} from './weapons.ts';
import {CollisionMap, type RoadNode} from './world-map.ts';

const PLAYER_RADIUS = 11;
const PLAYER_SPEED = 190;
const NPC_RADIUS = 10;
const VEHICLE_RADIUS = 20;
const POLICE_FIRE_COOLDOWN_MS = 680;
const RESPAWN_DELAY_MS = 3000;
const HEAT_DECAY_DELAY_MS = 10_000;
const HEAT_DECAY_STEP_MS = 6500;
const MAX_VEHICLE_OCCUPANTS = 4;
const TRAFFIC_VEHICLE_COUNT = 8;
const ENTER_VEHICLE_DURATION_MS = 320;
const HIJACK_DURATION_MS = 1050;

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
  lastShotAt: number;
  lastCrimeAt: number;
  lastHeatDecayAt: number;
}

interface RuntimeNpc {
  wanderAngle: number;
  nextThinkAt: number;
  lastShotAt: number;
  panicUntil: number;
  threatId: string;
  respawnAt: number;
}

interface RuntimeTraffic {
  previousColumn: number;
  previousRow: number;
  targetColumn: number;
  targetRow: number;
  cruiseSpeed: number;
}

export class DistrictRoom extends Room<DistrictState> {
  maxClients = 32;
  autoDispose = false;
  patchRate = 50;

  private readonly runtimePlayers = new Map<string, RuntimePlayer>();
  private readonly runtimeNpcs = new Map<string, RuntimeNpc>();
  private readonly runtimeTraffic = new Map<string, RuntimeTraffic>();
  private readonly vehicleImpactAt = new Map<string, number>();
  private readonly simulationClock = new FixedStepClock();
  private readonly spatialIndex = new SpatialIndex<WorldEntityKind>();
  private readonly lifecycle = new DeferredCommandQueue();
  private readonly events = new GameEventStream();
  private readonly debugEnabled = process.env.GAME_DEBUG === '1' || process.env.NODE_ENV !== 'production';
  private readonly recentDebugEvents: DebugEventEntry[] = [];
  private random = new DeterministicRandom('industrial-district:v1');
  private lastTickEvents: GameEvent[] = [];
  private lastDebugBroadcastTick = 0;
  private world!: CollisionMap;
  private nextBulletId = 1;
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

    this.onMessage('shoot', (client) => this.shoot(client.sessionId));
    this.onMessage<CycleWeaponMessage>('cycleWeapon', (client, message) => {
      this.cycleWeapon(client.sessionId, message?.direction);
    });
    this.onMessage('interact', (client) => this.interact(client.sessionId));
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
      inputY: 0,
      lastShotAt: Number.NEGATIVE_INFINITY,
      lastCrimeAt: Number.NEGATIVE_INFINITY,
      lastHeatDecayAt: Number.NEGATIVE_INFINITY
    });
    this.indexPlayer(player);
  }

  onLeave(client: Client): void {
    const player = this.state.players.get(client.sessionId);
    if (player) this.removePlayerFromVehicle(player);
    this.state.players.delete(client.sessionId);
    this.runtimePlayers.delete(client.sessionId);
    this.spatialIndex.remove('player', client.sessionId);
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
      vehicle.traffic = true;
      this.state.vehicles.set(vehicle.id, vehicle);
      this.runtimeTraffic.set(vehicle.id, {
        previousColumn: spawn.column,
        previousRow: spawn.row,
        targetColumn: spawn.targetColumn,
        targetRow: spawn.targetRow,
        cruiseSpeed: 105 + (index % 4) * 14
      });
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
    this.state.vehicles.forEach((vehicle) => {
      this.updateVehicle(vehicle, deltaSeconds, now);
      this.indexVehicle(vehicle);
    });
    this.state.players.forEach((player, playerId) => {
      const runtime = this.runtimePlayers.get(playerId);
      if (!runtime) return;
      if (!player.alive) {
        this.tryRespawnPlayer(player, runtime, now);
      } else if (player.action) {
        this.updatePlayerAction(player, now);
      } else {
        if (!player.vehicleId) this.movePlayer(player, runtime, deltaSeconds);
        this.decayHeat(player, runtime, now);
      }
      this.indexPlayer(player);
    });
    this.state.npcs.forEach((npc) => {
      this.updateNpc(npc, deltaSeconds, now);
      this.indexNpc(npc);
    });
    this.state.bullets.forEach((bullet, bulletId) => {
      this.moveBullet(bullet, bulletId, deltaSeconds, now);
    });
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

  private updateVehicle(vehicle: VehicleState, deltaSeconds: number, now: number): void {
    if (vehicle.traffic && !vehicle.driverId) {
      this.updateTrafficVehicle(vehicle, deltaSeconds, now);
      this.syncVehicleOccupants(vehicle);
      return;
    }

    const driver = vehicle.driverId ? this.state.players.get(vehicle.driverId) : undefined;
    const runtime = vehicle.driverId ? this.runtimePlayers.get(vehicle.driverId) : undefined;
    if (driver?.alive && runtime) {
      const throttle = -runtime.inputY;
      if (throttle !== 0) {
        const acceleration = throttle > 0 ? 390 : 270;
        vehicle.speed += throttle * acceleration * deltaSeconds;
      } else {
        vehicle.speed = approach(vehicle.speed, 0, 150 * deltaSeconds);
      }
      vehicle.speed = clamp(vehicle.speed, -115, 410);

      if (Math.abs(vehicle.speed) > 4 && runtime.inputX !== 0) {
        const grip = clamp(Math.abs(vehicle.speed) / 120, 0.22, 1);
        const direction = vehicle.speed >= 0 ? 1 : -1;
        vehicle.angle = normalizeAngle(
          vehicle.angle + runtime.inputX * 2.35 * grip * direction * deltaSeconds
        );
      }

      const nextX = vehicle.x + Math.cos(vehicle.angle) * vehicle.speed * deltaSeconds;
      const nextY = vehicle.y + Math.sin(vehicle.angle) * vehicle.speed * deltaSeconds;
      if (this.world.canOccupy(nextX, nextY, VEHICLE_RADIUS)) {
        vehicle.x = nextX;
        vehicle.y = nextY;
      } else {
        vehicle.speed *= -0.2;
      }

      this.handleVehicleImpacts(vehicle, driver, now);
    } else {
      if (vehicle.driverId) {
        vehicle.driverId = '';
        this.promotePassenger(vehicle);
      }
      vehicle.speed = approach(vehicle.speed, 0, 220 * deltaSeconds);
    }
    this.syncVehicleOccupants(vehicle);
  }

  private updateTrafficVehicle(vehicle: VehicleState, deltaSeconds: number, now: number): void {
    const runtime = this.runtimeTraffic.get(vehicle.id);
    if (!runtime) return;
    if (vehicle.hijackBy) {
      vehicle.speed = approach(vehicle.speed, 0, 520 * deltaSeconds);
      return;
    }

    const targetX = (runtime.targetColumn + 0.5) * this.world.tileWidth;
    const targetY = (runtime.targetRow + 0.5) * this.world.tileHeight;
    const distance = Math.hypot(targetX - vehicle.x, targetY - vehicle.y);
    if (distance <= Math.max(8, vehicle.speed * deltaSeconds)) {
      vehicle.x = targetX;
      vehicle.y = targetY;
      const current = {column: runtime.targetColumn, row: runtime.targetRow};
      const next = this.chooseNextRoadNode(current, runtime, now + vehicle.id.length * 37);
      runtime.previousColumn = current.column;
      runtime.previousRow = current.row;
      runtime.targetColumn = next.column;
      runtime.targetRow = next.row;
      return;
    }

    const desiredAngle = Math.atan2(targetY - vehicle.y, targetX - vehicle.x);
    vehicle.angle = rotateToward(vehicle.angle, desiredAngle, 4.2 * deltaSeconds);
    vehicle.speed = approach(vehicle.speed, runtime.cruiseSpeed, 85 * deltaSeconds);
    const movement = Math.min(distance, vehicle.speed * deltaSeconds);
    const nextX = vehicle.x + Math.cos(desiredAngle) * movement;
    const nextY = vehicle.y + Math.sin(desiredAngle) * movement;
    if (this.world.canOccupy(nextX, nextY, VEHICLE_RADIUS) && this.world.isRoadAt(nextX, nextY)) {
      vehicle.x = nextX;
      vehicle.y = nextY;
      this.handleTrafficImpacts(vehicle, now);
    } else {
      const currentColumn = Math.floor(vehicle.x / this.world.tileWidth);
      const currentRow = Math.floor(vehicle.y / this.world.tileHeight);
      const next = this.chooseNextRoadNode(
        {column: currentColumn, row: currentRow},
        runtime,
        now + 911
      );
      runtime.targetColumn = next.column;
      runtime.targetRow = next.row;
      vehicle.speed *= 0.35;
    }
  }

  private chooseNextRoadNode(current: RoadNode, runtime: RuntimeTraffic, seed: number): RoadNode {
    const neighbors = this.world.roadNeighbors(current.column, current.row);
    if (neighbors.length === 0) return current;
    const forwardColumn = current.column + (current.column - runtime.previousColumn);
    const forwardRow = current.row + (current.row - runtime.previousRow);
    const forward = neighbors.find((node) => node.column === forwardColumn && node.row === forwardRow);
    if (forward && (neighbors.length <= 2 || this.random.unit('traffic-forward', seed) < 0.88)) {
      return forward;
    }
    const alternatives = neighbors.filter((node) =>
      node.column !== runtime.previousColumn || node.row !== runtime.previousRow
    );
    const choices = alternatives.length > 0 ? alternatives : neighbors;
    return choices[this.random.integer('traffic-turn', seed + 17, 0, choices.length)];
  }

  private syncVehicleOccupants(vehicle: VehicleState): void {
    for (const player of this.state.players.values()) {
      if (player.vehicleId !== vehicle.id) continue;
      player.x = vehicle.x;
      player.y = vehicle.y;
      if (player.vehicleSeat === 0) player.angle = vehicle.angle;
    }
  }

  private handleTrafficImpacts(vehicle: VehicleState, now: number): void {
    if (vehicle.speed < 70 || now - (this.vehicleImpactAt.get(vehicle.id) ?? 0) < 600) return;
    const nearbyPlayers = this.spatialIndex.queryCircle(vehicle.x, vehicle.y, VEHICLE_RADIUS, {
      kinds: ['player'],
      includeRecordRadius: true
    });
    for (const record of nearbyPlayers) {
      const player = this.state.players.get(record.id);
      if (!player) continue;
      if (!player.alive || player.vehicleId) continue;
      if (Math.hypot(player.x - vehicle.x, player.y - vehicle.y) > VEHICLE_RADIUS + PLAYER_RADIUS) continue;
      this.damagePlayer(player, 45, '', now);
      vehicle.speed *= 0.55;
      this.vehicleImpactAt.set(vehicle.id, now);
      return;
    }
    const nearbyNpcs = this.spatialIndex.queryCircle(vehicle.x, vehicle.y, VEHICLE_RADIUS, {
      kinds: ['npc'],
      includeRecordRadius: true
    });
    for (const record of nearbyNpcs) {
      const npc = this.state.npcs.get(record.id);
      if (!npc) continue;
      if (!npc.alive) continue;
      if (Math.hypot(npc.x - vehicle.x, npc.y - vehicle.y) > VEHICLE_RADIUS + NPC_RADIUS) continue;
      this.damageNpc(npc, 100, '', now);
      vehicle.speed *= 0.62;
      this.vehicleImpactAt.set(vehicle.id, now);
      return;
    }
  }

  private handleVehicleImpacts(vehicle: VehicleState, driver: PlayerState, now: number): void {
    if (Math.abs(vehicle.speed) < 90 || now - (this.vehicleImpactAt.get(vehicle.id) ?? 0) < 450) return;

    const nearbyNpcs = this.spatialIndex.queryCircle(vehicle.x, vehicle.y, VEHICLE_RADIUS, {
      kinds: ['npc'],
      includeRecordRadius: true
    });
    for (const record of nearbyNpcs) {
      const npc = this.state.npcs.get(record.id);
      if (!npc) continue;
      if (!npc.alive || Math.hypot(npc.x - vehicle.x, npc.y - vehicle.y) > VEHICLE_RADIUS + NPC_RADIUS) continue;
      this.damageNpc(npc, Math.min(100, Math.round(Math.abs(vehicle.speed) * 0.45)), driver.id, now);
      vehicle.speed *= 0.72;
      this.vehicleImpactAt.set(vehicle.id, now);
      return;
    }

    const nearbyPlayers = this.spatialIndex.queryCircle(vehicle.x, vehicle.y, VEHICLE_RADIUS, {
      kinds: ['player'],
      includeRecordRadius: true
    });
    for (const record of nearbyPlayers) {
      const player = this.state.players.get(record.id);
      if (!player) continue;
      if (!player.alive || player.id === driver.id || player.vehicleId) continue;
      if (Math.hypot(player.x - vehicle.x, player.y - vehicle.y) > VEHICLE_RADIUS + PLAYER_RADIUS) continue;
      this.damagePlayer(player, 50, driver.id, now);
      vehicle.speed *= 0.68;
      this.vehicleImpactAt.set(vehicle.id, now);
      return;
    }
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
      const target = this.nearestWantedPlayer(npc.x, npc.y);
      if (target) {
        const angle = Math.atan2(target.y - npc.y, target.x - npc.x);
        const distance = Math.hypot(target.x - npc.x, target.y - npc.y);
        npc.angle = angle;
        if (distance > 165) this.moveNpc(npc, angle, 158, deltaSeconds);
        if (
          distance < 430 &&
          now - runtime.lastShotAt >= POLICE_FIRE_COOLDOWN_MS &&
          this.world.hasLineOfSight(npc.x, npc.y, target.x, target.y)
        ) {
          runtime.lastShotAt = now;
          this.createBullet(npc.id, 'police', npc.x, npc.y, angle, now, 'pistol');
        }
        return;
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

  private nearestWantedPlayer(x: number, y: number): PlayerState | undefined {
    let nearest: PlayerState | undefined;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const player of this.state.players.values()) {
      if (!player.alive || player.wanted <= 0) continue;
      const distance = Math.hypot(player.x - x, player.y - y);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearest = player;
      }
    }
    return nearest;
  }

  private interact(playerId: string): void {
    const player = this.state.players.get(playerId);
    if (!player?.alive || player.action) return;

    if (player.vehicleId) {
      const vehicle = this.state.vehicles.get(player.vehicleId);
      if (!vehicle) {
        player.vehicleId = '';
        player.vehicleSeat = -1;
        return;
      }
      this.exitVehicle(player, vehicle);
      return;
    }

    let nearest: VehicleState | undefined;
    let nearestDistance = 72;
    const nearbyVehicles = this.spatialIndex.queryCircle(player.x, player.y, nearestDistance, {
      kinds: ['vehicle']
    });
    for (const record of nearbyVehicles) {
      const vehicle = this.state.vehicles.get(record.id);
      if (!vehicle) continue;
      if (this.vehicleOccupants(vehicle.id).length >= MAX_VEHICLE_OCCUPANTS) continue;
      if (vehicle.hijackBy && vehicle.hijackBy !== player.id) continue;
      const distance = Math.hypot(vehicle.x - player.x, vehicle.y - player.y);
      if (distance < nearestDistance) {
        nearest = vehicle;
        nearestDistance = distance;
      }
    }
    if (!nearest) return;
    const action = nearest.traffic && !nearest.driverId ? 'hijacking' : 'entering';
    this.beginVehicleAction(player, nearest, action, this.simulationClock.nowMs);
  }

  private beginVehicleAction(
    player: PlayerState,
    vehicle: VehicleState,
    action: 'entering' | 'hijacking',
    now: number
  ): void {
    const sideAngle = vehicle.angle + Math.PI / 2;
    const sides = [1, -1];
    sides.sort((left, right) => {
      const leftDistance = Math.hypot(
        player.x - (vehicle.x + Math.cos(sideAngle) * 38 * left),
        player.y - (vehicle.y + Math.sin(sideAngle) * 38 * left)
      );
      const rightDistance = Math.hypot(
        player.x - (vehicle.x + Math.cos(sideAngle) * 38 * right),
        player.y - (vehicle.y + Math.sin(sideAngle) * 38 * right)
      );
      return leftDistance - rightDistance;
    });
    for (const side of sides) {
      const x = vehicle.x + Math.cos(sideAngle) * 38 * side;
      const y = vehicle.y + Math.sin(sideAngle) * 38 * side;
      if (!this.world.canOccupy(x, y, PLAYER_RADIUS)) continue;
      player.x = x;
      player.y = y;
      break;
    }
    player.angle = vehicle.angle;
    player.action = action;
    player.actionVehicleId = vehicle.id;
    player.actionUntil = now + (action === 'hijacking' ? HIJACK_DURATION_MS : ENTER_VEHICLE_DURATION_MS);
    if (action === 'hijacking') vehicle.hijackBy = player.id;
  }

  private updatePlayerAction(player: PlayerState, now: number): void {
    if (now < player.actionUntil) return;
    const action = player.action;
    const vehicle = this.state.vehicles.get(player.actionVehicleId);
    if (!vehicle || Math.hypot(vehicle.x - player.x, vehicle.y - player.y) > 112) {
      if (vehicle?.hijackBy === player.id) vehicle.hijackBy = '';
      this.clearPlayerAction(player);
      return;
    }

    if (action === 'hijacking') {
      if (vehicle.hijackBy !== player.id || !vehicle.traffic) {
        this.clearPlayerAction(player);
        return;
      }
      vehicle.traffic = false;
      vehicle.hijackBy = '';
      vehicle.speed = 0;
      this.runtimeTraffic.delete(vehicle.id);
      this.spawnEjectedDriver(vehicle, player, now);
      this.recordCrime(player.id, 1, now);
    }

    this.clearPlayerAction(player);
    this.enterVehicle(player, vehicle);
  }

  private enterVehicle(player: PlayerState, vehicle: VehicleState): void {
    const occupiedSeats = new Set(this.vehicleOccupants(vehicle.id).map((occupant) => occupant.vehicleSeat));
    let seat = vehicle.driverId ? 1 : 0;
    while (seat < MAX_VEHICLE_OCCUPANTS && occupiedSeats.has(seat)) seat++;
    if (seat >= MAX_VEHICLE_OCCUPANTS) return;
    player.vehicleId = vehicle.id;
    player.vehicleSeat = seat;
    player.x = vehicle.x;
    player.y = vehicle.y;
    player.angle = vehicle.angle;
    if (seat === 0) vehicle.driverId = player.id;
  }

  private exitVehicle(player: PlayerState, vehicle: VehicleState): void {
    const sideAngle = vehicle.angle + Math.PI / 2;
    const candidates = [1, -1, 1.55, -1.55];
    for (const side of candidates) {
      const x = vehicle.x + Math.cos(sideAngle) * 42 * side;
      const y = vehicle.y + Math.sin(sideAngle) * 42 * side;
      if (!this.world.canOccupy(x, y, PLAYER_RADIUS)) continue;
      player.x = x;
      player.y = y;
      this.removePlayerFromVehicle(player);
      vehicle.speed *= 0.4;
      return;
    }
  }

  private removePlayerFromVehicle(player: PlayerState): void {
    const vehicle = player.vehicleId ? this.state.vehicles.get(player.vehicleId) : undefined;
    const wasDriver = vehicle?.driverId === player.id;
    player.vehicleId = '';
    player.vehicleSeat = -1;
    if (vehicle && wasDriver) {
      vehicle.driverId = '';
      this.promotePassenger(vehicle);
    }
    if (player.actionVehicleId) {
      const actionVehicle = this.state.vehicles.get(player.actionVehicleId);
      if (actionVehicle?.hijackBy === player.id) actionVehicle.hijackBy = '';
    }
    this.clearPlayerAction(player);
  }

  private promotePassenger(vehicle: VehicleState): void {
    const passenger = this.vehicleOccupants(vehicle.id)
      .filter((occupant) => occupant.alive)
      .sort((left, right) => left.vehicleSeat - right.vehicleSeat)[0];
    if (!passenger) return;
    passenger.vehicleSeat = 0;
    vehicle.driverId = passenger.id;
  }

  private vehicleOccupants(vehicleId: string): PlayerState[] {
    return [...this.state.players.values()].filter((player) => player.vehicleId === vehicleId);
  }

  private clearPlayerAction(player: PlayerState): void {
    player.action = '';
    player.actionUntil = 0;
    player.actionVehicleId = '';
  }

  private spawnEjectedDriver(vehicle: VehicleState, hijacker: PlayerState, now: number): void {
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
  }

  private shoot(playerId: string): void {
    const player = this.state.players.get(playerId);
    const runtime = this.runtimePlayers.get(playerId);
    const now = this.simulationClock.nowMs;
    if (
      !player?.alive ||
      (player.vehicleId && player.vehicleSeat === 0) ||
      player.action ||
      !runtime
    ) return;

    const weaponId = isWeaponId(player.weapon) ? player.weapon : 'pistol';
    const weapon = WEAPONS[weaponId];
    if (now - runtime.lastShotAt < weapon.cooldownMs || ammoFor(player, weaponId) <= 0) return;

    runtime.lastShotAt = now;
    setAmmo(player, weaponId, ammoFor(player, weaponId) - 1);
    const origin = this.playerShotOrigin(player);
    for (let pellet = 0; pellet < weapon.pellets; pellet++) {
      const spread = weapon.pellets === 1
        ? (this.random.unit('weapon-spread', `${playerId}:${this.simulationClock.tick}`) - 0.5) * weapon.spread
        : ((pellet / (weapon.pellets - 1)) - 0.5) * weapon.spread;
      this.createBullet(playerId, 'player', origin.x, origin.y, player.angle + spread, now, weaponId);
    }
  }

  private playerShotOrigin(player: PlayerState): {x: number; y: number} {
    if (!player.vehicleId || player.vehicleSeat <= 0) return {x: player.x, y: player.y};
    const vehicle = this.state.vehicles.get(player.vehicleId);
    if (!vehicle) return {x: player.x, y: player.y};
    const forwardOffset = player.vehicleSeat === 3 ? -11 : 5;
    const sideOffset = player.vehicleSeat === 1 ? 15 : (player.vehicleSeat === 2 ? -15 : 0);
    const sideAngle = vehicle.angle + Math.PI / 2;
    return {
      x: vehicle.x + Math.cos(vehicle.angle) * forwardOffset + Math.cos(sideAngle) * sideOffset,
      y: vehicle.y + Math.sin(vehicle.angle) * forwardOffset + Math.sin(sideAngle) * sideOffset
    };
  }

  private cycleWeapon(playerId: string, rawDirection: unknown): void {
    const player = this.state.players.get(playerId);
    if (!player?.alive || (player.vehicleId && player.vehicleSeat === 0) || player.action) return;
    const current = isWeaponId(player.weapon) ? WEAPON_ORDER.indexOf(player.weapon) : 0;
    const direction = Number(rawDirection) < 0 ? -1 : 1;
    player.weapon = WEAPON_ORDER[(current + direction + WEAPON_ORDER.length) % WEAPON_ORDER.length];
  }

  private createBullet(
    ownerId: string,
    ownerKind: 'player' | 'police',
    x: number,
    y: number,
    angle: number,
    now: number,
    weapon: WeaponId
  ): void {
    const bullet = new BulletState();
    bullet.id = String(this.nextBulletId++);
    bullet.ownerId = ownerId;
    bullet.ownerKind = ownerKind;
    bullet.angle = angle;
    bullet.weapon = weapon;
    bullet.x = x + Math.cos(angle) * 18;
    bullet.y = y + Math.sin(angle) * 18;
    bullet.createdAt = now;
    this.state.bullets.set(bullet.id, bullet);
  }

  private moveBullet(bullet: BulletState, bulletId: string, deltaSeconds: number, now: number): void {
    const weapon = WEAPONS[isWeaponId(bullet.weapon) ? bullet.weapon : 'pistol'];
    if (now - bullet.createdAt > weapon.lifetimeMs) {
      this.deferBulletRemoval(bulletId);
      return;
    }

    const previousX = bullet.x;
    const previousY = bullet.y;
    bullet.x += Math.cos(bullet.angle) * weapon.projectileSpeed * deltaSeconds;
    bullet.y += Math.sin(bullet.angle) * weapon.projectileSpeed * deltaSeconds;
    if (this.world.isBlockedAt(bullet.x, bullet.y)) {
      this.deferBulletRemoval(bulletId);
      return;
    }

    const minX = Math.min(previousX, bullet.x) - 4;
    const minY = Math.min(previousY, bullet.y) - 4;
    const maxX = Math.max(previousX, bullet.x) + 4;
    const maxY = Math.max(previousY, bullet.y) + 4;
    const playerCandidates = this.spatialIndex.queryAabb(minX, minY, maxX, maxY, {
      kinds: ['player']
    });
    for (const record of playerCandidates) {
      const target = this.state.players.get(record.id);
      if (!target) continue;
      if (!target.alive || target.vehicleId || target.id === bullet.ownerId) continue;
      if (bullet.ownerKind === 'police' && target.wanted <= 0) continue;
      if (pointSegmentDistance(target.x, target.y, previousX, previousY, bullet.x, bullet.y) > PLAYER_RADIUS + 4) continue;
      this.damagePlayer(target, weapon.damage, bullet.ownerKind === 'player' ? bullet.ownerId : '', now);
      this.deferBulletRemoval(bulletId);
      return;
    }

    if (bullet.ownerKind === 'player') {
      const npcCandidates = this.spatialIndex.queryAabb(minX, minY, maxX, maxY, {kinds: ['npc']});
      for (const record of npcCandidates) {
        const target = this.state.npcs.get(record.id);
        if (!target) continue;
        if (
          !target.alive ||
          pointSegmentDistance(target.x, target.y, previousX, previousY, bullet.x, bullet.y) > NPC_RADIUS + 4
        ) continue;
        this.damageNpc(target, weapon.damage, bullet.ownerId, now);
        this.deferBulletRemoval(bulletId);
        return;
      }
    }
  }

  private damagePlayer(target: PlayerState, damage: number, attackerId: string, now: number): void {
    const previousHealth = target.health;
    target.health = Math.max(0, target.health - damage);
    this.events.publish({
      type: 'damage.applied',
      tick: this.simulationClock.tick,
      nowMs: now,
      targetId: target.id,
      targetKind: 'player',
      attackerId,
      amount: previousHealth - target.health,
      remainingHealth: target.health
    });
    if (attackerId) this.recordCrime(attackerId, 1, now);
    if (target.health > 0) return;

    if (attackerId) {
      const attacker = this.state.players.get(attackerId);
      if (attacker) attacker.cash += 100;
    }
    this.killPlayer(target, now, attackerId);
  }

  private damageNpc(target: NpcState, damage: number, attackerId: string, now: number): void {
    const previousHealth = target.health;
    target.health = Math.max(0, target.health - damage);
    this.events.publish({
      type: 'damage.applied',
      tick: this.simulationClock.tick,
      nowMs: now,
      targetId: target.id,
      targetKind: 'npc',
      attackerId,
      amount: previousHealth - target.health,
      remainingHealth: target.health
    });
    this.recordCrime(attackerId, target.kind === 'police' ? 2 : 1, now);
    const runtime = this.runtimeNpcs.get(target.id);
    if (runtime) {
      runtime.panicUntil = now + 4500;
      runtime.threatId = attackerId;
    }
    if (target.health > 0) return;

    target.alive = false;
    this.events.publish({
      type: 'entity.killed',
      tick: this.simulationClock.tick,
      nowMs: now,
      entityId: target.id,
      entityKind: 'npc',
      attackerId
    });
    if (runtime) runtime.respawnAt = now + 5500;
    const attacker = this.state.players.get(attackerId);
    if (attacker) attacker.cash += target.kind === 'police' ? 200 : 50;
  }

  private killPlayer(player: PlayerState, now: number, attackerId: string): void {
    player.alive = false;
    player.health = 0;
    player.respawnAt = now + RESPAWN_DELAY_MS;
    this.events.publish({
      type: 'entity.killed',
      tick: this.simulationClock.tick,
      nowMs: now,
      entityId: player.id,
      entityKind: 'player',
      attackerId
    });
    const runtime = this.runtimePlayers.get(player.id);
    if (runtime) {
      runtime.inputX = 0;
      runtime.inputY = 0;
    }
    const vehicle = player.vehicleId ? this.state.vehicles.get(player.vehicleId) : undefined;
    this.removePlayerFromVehicle(player);
    if (vehicle) vehicle.speed *= 0.45;
  }

  private tryRespawnPlayer(player: PlayerState, runtime: RuntimePlayer, now: number): void {
    if (now < player.respawnAt) return;
    const spawn = this.world.openPointNear(
      this.world.spawn.x,
      this.world.spawn.y,
      0,
      180,
      PLAYER_RADIUS,
      now + player.id.length
    );
    player.x = spawn.x;
    player.y = spawn.y;
    player.angle = -Math.PI / 2;
    player.health = 100;
    player.alive = true;
    player.respawnAt = 0;
    player.wanted = 0;
    player.vehicleId = '';
    player.vehicleSeat = -1;
    this.clearPlayerAction(player);
    refillAmmo(player);
    runtime.lastCrimeAt = Number.NEGATIVE_INFINITY;
    runtime.lastHeatDecayAt = now;
    this.events.publish({
      type: 'player.respawned',
      tick: this.simulationClock.tick,
      nowMs: now,
      playerId: player.id,
      x: player.x,
      y: player.y
    });
  }

  private recordCrime(playerId: string, heat: number, now: number): void {
    const player = this.state.players.get(playerId);
    const runtime = this.runtimePlayers.get(playerId);
    if (!player || !runtime) return;
    player.wanted = Math.min(5, player.wanted + heat);
    runtime.lastCrimeAt = now;
    runtime.lastHeatDecayAt = now;
    this.events.publish({
      type: 'crime.committed',
      tick: this.simulationClock.tick,
      nowMs: now,
      suspectId: playerId,
      heat,
      resultingWantedLevel: player.wanted
    });
  }

  private decayHeat(player: PlayerState, runtime: RuntimePlayer, now: number): void {
    if (player.wanted === 0 || now - runtime.lastCrimeAt < HEAT_DECAY_DELAY_MS) return;
    const policeNearby = this.spatialIndex.queryCircle(player.x, player.y, 430, {kinds: ['npc']})
      .some((record) => {
        const npc = this.state.npcs.get(record.id);
        return Boolean(npc?.kind === 'police' && npc.alive);
      });
    if (!policeNearby && now - runtime.lastHeatDecayAt >= HEAT_DECAY_STEP_MS) {
      player.wanted -= 1;
      runtime.lastHeatDecayAt = now;
    }
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

  private deferBulletRemoval(bulletId: string): void {
    this.lifecycle.defer(`bullet.remove:${bulletId}`, () => {
      this.state.bullets.delete(bulletId);
    });
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
      return `${event.suspectId} heat +${event.heat} => ${event.resultingWantedLevel}`;
    case 'player.respawned':
      return `${event.playerId} respawned`;
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

function approach(value: number, target: number, amount: number): number {
  if (value < target) return Math.min(target, value + amount);
  if (value > target) return Math.max(target, value - amount);
  return value;
}

function rotateToward(current: number, target: number, amount: number): number {
  const difference = Math.atan2(Math.sin(target - current), Math.cos(target - current));
  return normalizeAngle(current + clamp(difference, -amount, amount));
}

function pointSegmentDistance(
  pointX: number,
  pointY: number,
  startX: number,
  startY: number,
  endX: number,
  endY: number
): number {
  const segmentX = endX - startX;
  const segmentY = endY - startY;
  const lengthSquared = segmentX * segmentX + segmentY * segmentY;
  if (lengthSquared === 0) return Math.hypot(pointX - startX, pointY - startY);
  const progress = clamp(
    ((pointX - startX) * segmentX + (pointY - startY) * segmentY) / lengthSquared,
    0,
    1
  );
  return Math.hypot(
    pointX - (startX + segmentX * progress),
    pointY - (startY + segmentY * progress)
  );
}
