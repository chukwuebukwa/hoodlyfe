import assert from 'node:assert/strict';
import test, {before} from 'node:test';
import {DistrictRoom} from '../server/district-room.ts';
import {DistrictState, NpcState, PlayerState, VehicleState} from '../server/state.ts';
import {VEHICLE_KINDS, vehicleDefinition} from '../shared/content/vehicle-catalog.ts';
import {
  integrateVehicleMotion,
  VEHICLE_SIMULATION_STEP_SECONDS,
  type VehicleControlCommand
} from '../shared/simulation/vehicle-step.ts';
import {
  initializePhysicsEngine,
  PhysicsWorld,
  type PhysicsWorldGeometry
} from '../shared/physics/physics-world.ts';
import type {VehicleMotionState} from '../shared/simulation/vehicle-step.ts';
import {attachTestVehicleSimulation} from './support/vehicle-simulation.ts';

const DT = VEHICLE_SIMULATION_STEP_SECONDS;
const PARITY_TICKS = Math.round(12 / DT);
const GRID = 64;
const TILE = 64;

before(async () => {
  await initializePhysicsEngine();
});

// Stage-1 acceptance (RAPIER_MIGRATION_ADAPTATION_CONTRACT.md): trajectories within
// 2 px of the handling kernel over 12 s per kind on open road.
test('driven vehicles reproduce kernel trajectories through the engine per kind', () => {
  for (const kind of VEHICLE_KINDS) {
    const physics = PhysicsWorld.create(geometry());
    const {room, car} = fixture(kind, physics, {x: 2048, y: 2048});
    let reference: VehicleMotionState = {
      x: car.x,
      y: car.y,
      angle: 0,
      speed: 0,
      linvelX: 0,
      linvelY: 0,
      angvel: 0
    };
    let maxPositionError = 0;
    let maxAngleError = 0;
    for (let tick = 0; tick < PARITY_TICKS; tick++) {
      const command = maneuverAt(tick);
      reference = integrateVehicleMotion(reference, command, kind, DT);
      driveTick(room, car, command, tick);
      maxPositionError = Math.max(
        maxPositionError,
        Math.hypot(car.x - reference.x, car.y - reference.y)
      );
      maxAngleError = Math.max(maxAngleError, Math.abs(normalizeAngle(car.angle - reference.angle)));
    }
    physics.free();
    assert.ok(
      maxPositionError < 2,
      `${kind} diverged ${maxPositionError.toFixed(3)}px from the handling kernel`
    );
    assert.ok(
      maxAngleError < 0.01,
      `${kind} heading diverged ${maxAngleError.toFixed(4)}rad from the handling kernel`
    );
  }
});

test('handbrake preserves lateral momentum and counter-steering recovers the car', () => {
  const physics = PhysicsWorld.create(geometry());
  const {room, car} = fixture('s15', physics, {x: 2048, y: 2048});
  for (let tick = 0; tick < 75; tick++) {
    driveTick(room, car, {throttle: 1, steering: 0}, tick);
  }
  const bodyIdentity = room.vehicleSimulation.physicsBodyIdentity(`vehicle:${car.id}`);
  for (let tick = 75; tick < 95; tick++) {
    driveTick(room, car, {throttle: 0.75, steering: 0.8, handbrake: true}, tick);
  }
  const driftSlip = Math.abs(vehicleSlipAngle(car));
  assert.ok(driftSlip > 0.3, `handbrake slip ${driftSlip.toFixed(3)}rad was not a drift`);
  assert.equal(room.vehicleSimulation.physicsBodyIdentity(`vehicle:${car.id}`), bodyIdentity);

  for (let tick = 95; tick < 125; tick++) {
    driveTick(room, car, {throttle: 0.35, steering: -0.65}, tick);
  }
  const recoveredSlip = Math.abs(vehicleSlipAngle(car));
  physics.free();
  assert.ok(
    recoveredSlip < driftSlip * 0.5,
    `counter-steering left ${recoveredSlip.toFixed(3)}rad from ${driftSlip.toFixed(3)}rad`
  );
});

test('world contact stops the vehicle at the wall and applies impact damage', () => {
  const wallColumn = 40;
  const physics = PhysicsWorld.create(geometry(wallColumn));
  const {room, car} = fixture('sedan', physics, {x: 2048, y: 2048});
  const initialHealth = car.health;
  const wallX = wallColumn * TILE;
  const halfLength = vehicleDefinition('sedan').collision.length / 2;
  for (let tick = 0; tick < Math.round(5 / DT); tick++) {
    driveTick(room, car, {throttle: 1, steering: 0}, tick);
    // The solver resolves impact penetration over a few ticks; only depths beyond
    // that transient indicate tunnelling.
    assert.ok(
      car.x + halfLength <= wallX + 8,
      `vehicle tunnelled to x=${car.x.toFixed(1)} past wall at ${wallX}`
    );
  }
  physics.free();
  assert.ok(car.x + halfLength <= wallX + 5, 'vehicle did not settle against the wall face');
  assert.ok(car.x > wallX - 200, 'vehicle never reached the wall');
  assert.ok(car.health < initialHealth, 'wall impact applied no damage');
  assert.ok(Math.abs(car.speed) < 120, `vehicle kept speed ${car.speed.toFixed(0)} against the wall`);
});

test('elevated vehicles ignore flat statics from the sheet below', () => {
  const wallColumn = 40;
  const wallX = wallColumn * TILE;
  const physics = PhysicsWorld.create(geometry(wallColumn));
  const {room, car, driver} = fixture('sedan', physics, {x: wallX - 180, y: 2048});
  car.surfaceId = 'bridge';
  driver.surfaceId = 'bridge';
  room.world.surfaces = {manifest: {defaultSurfaceId: 'street-ground'}};
  room.world.surfaceAfterMove = () => 'bridge';

  for (let tick = 0; tick < Math.round(3 / DT); tick++) {
    driveTick(room, car, {throttle: 1, steering: 0}, tick);
  }

  physics.free();
  assert.ok(car.x > wallX + 40, `elevated vehicle stopped at flat wall: ${car.x}`);
});

test('driven vehicles leave exposed elevated edges and land on the lower surface', () => {
  const physics = PhysicsWorld.create(geometry());
  const {room, car, driver} = fixture('sedan', physics, {x: 2048, y: 2048});
  car.surfaceId = 'bridge';
  car.elevation = 128;
  driver.surfaceId = 'bridge';
  driver.elevation = 128;
  room.world.surfaceAfterMove = () => undefined;
  let launchAvailable = true;
  room.world.dropTargetAfterMove = () => {
    if (!launchAvailable) return undefined;
    launchAvailable = false;
    return {surfaceId: 'street-ground', height: 0};
  };
  room.world.heightAt = (surfaceId: string) => surfaceId === 'bridge' ? 128 : 0;
  room.world.landingBelow = (
    _excludedSurfaceId: string,
    _x: number,
    _y: number,
    _radius: number,
    _actorType: string,
    maximumHeight: number
  ) => maximumHeight >= 0 ? {surfaceId: 'street-ground', height: 0} : undefined;

  car.speed = 320;
  car.linvelX = 320;
  room.playerControl.setMove(driver.id, {x: 0, y: -1});
  room.vehicleSimulation.beginTick();
  room.vehicleSimulation.update(car, DT, 0);
  room.vehicleSimulation.stepPhysics(DT, 0);

  assert.equal(car.airborne, true);
  assert.equal(car.surfaceId, 'bridge');
  assert.equal(car.landingSurfaceId, 'street-ground');
  assert.ok(car.linvelX > 0, 'launch discarded the vehicle forward momentum');

  for (let tick = 1; tick < 180 && car.airborne; tick++) {
    room.vehicleSimulation.beginTick();
    room.vehicleSimulation.update(car, DT, tick * 33);
    room.vehicleSimulation.stepPhysics(DT, tick * 33);
  }

  physics.free();
  assert.equal(
    car.airborne,
    false,
    `vehicle remained airborne at z=${car.elevation.toFixed(1)} with vZ=${car.verticalVelocity.toFixed(1)}`
  );
  assert.equal(car.surfaceId, 'street-ground');
  assert.equal(car.elevation, 0);
  assert.equal(driver.surfaceId, 'street-ground');
  assert.equal(driver.elevation, 0);
  assert.ok(car.x > 2048, 'airborne vehicle did not carry forward momentum');
});

test('physics path acknowledges input sequences and keeps undriven vehicles physical', () => {
  const physics = PhysicsWorld.create(geometry());
  const acknowledged: Array<{vehicleId: string; sequence: number}> = [];
  const {room, car, driver} = fixture('sedan', physics, {x: 2048, y: 2048}, {
    acknowledgeInput: (_playerId, vehicleId, sequence) => acknowledged.push({vehicleId, sequence})
  });
  const heldInput = room.playerControl.inputFor.bind(room.playerControl);
  room.playerControl.inputFor = (playerId: string) => {
    const held = heldInput(playerId);
    return held ? {...held, sequence: 7} : undefined;
  };

  driveTick(room, car, {throttle: 1, steering: 0}, 0);
  assert.ok(physics.has(`vehicle:${car.id}`));
  assert.deepEqual(acknowledged, [{vehicleId: car.id, sequence: 7}]);

  car.driverId = '';
  driver.vehicleId = '';
  room.vehicleSimulation.beginTick();
  room.vehicleSimulation.update(car, DT, 100);
  room.vehicleSimulation.stepPhysics(DT, 100);
  assert.equal(physics.has(`vehicle:${car.id}`), true);
  physics.free();
});

test('expired wreck removal does not sweep through actors', () => {
  const physics = PhysicsWorld.create(geometry());
  const room = new DistrictRoom() as any;
  room.world = {
    canOccupy: () => true,
    isBlockedAt: () => false
  };
  room.setState(new DistrictState());
  const car = new VehicleState();
  car.id = 'wreck';
  car.x = 100;
  car.y = 1000;
  car.destroyed = true;
  car.respawnAt = 1000;
  const bystander = new PlayerState();
  bystander.id = 'bystander';
  bystander.x = 200;
  bystander.y = 1000;
  room.state.vehicles.set(car.id, car);
  room.state.players.set(bystander.id, bystander);
  attachTestVehicleSimulation(room, {physics});

  room.vehicleSimulation.beginTick(1000);
  room.vehicleSimulation.update(car, DT, 1000);
  const result = room.vehicleSimulation.stepPhysics(DT, 1000);

  physics.free();
  assert.equal(room.state.vehicles.has(car.id), false);
  assert.equal(bystander.health, 100);
  assert.equal(result.contacts, 0);
});

test('traffic replacement adopts its new authoritative surface', () => {
  const physics = PhysicsWorld.create(geometry());
  const {room, car} = fixture('sedan', physics, {x: 2048, y: 2048});
  car.surfaceId = 'bridge';
  room.trafficController.register(car.id, {
    x: car.x,
    y: car.y,
    angle: car.angle,
    column: 0,
    row: 0,
    targetColumn: 1,
    targetRow: 0
  }, 100);
  room.trafficController.spawn = () => ({
    x: 300,
    y: 400,
    surfaceId: 'street-ground',
    angle: 0,
    column: 4,
    row: 6,
    targetColumn: 5,
    targetRow: 6
  });

  room.vehicleSimulation.returnToTraffic(car, 1_000);

  physics.free();
  assert.equal(car.surfaceId, 'street-ground');
});

test('40 driven vehicles preserve the 1ms amortized CPU baseline', () => {
  const physics = PhysicsWorld.create(geometry());
  const room = capacityRoom();
  const cars = addDrivenVehicles(room, 40, 1);
  const controller = attachTestVehicleSimulation(room, {physics});
  for (const car of cars) room.playerControl.register(car.driverId);
  let costMicros = 0;
  for (let tick = 0; tick < 300; tick++) {
    controller.beginTick();
    cars.forEach((car, index) => {
      room.playerControl.setMove(car.driverId, {x: index % 2 === 0 ? 1 : -1, y: -1});
      controller.update(car, DT, tick * 33);
    });
    const startedAt = process.cpuUsage();
    controller.stepPhysics(DT, tick * 33);
    const cost = process.cpuUsage(startedAt);
    costMicros += cost.user + cost.system;
  }
  const perTick = costMicros / 1000 / 300;
  physics.free();
  assert.ok(perTick < 1, `physics step ${perTick.toFixed(3)}ms/tick exceeds the 1ms baseline`);
});

// Capacity guardrail: more than double the crowded-combat reproduction load
// (21 NPCs / 10 vehicles), distributed across elevation partitions with contact pressure.
test('physics step stays below 4ms/tick with 48 NPCs and 40 driven vehicles', () => {
  const physics = PhysicsWorld.create(geometry());
  const room = capacityRoom();
  const cars = addDrivenVehicles(room, 40, 10);
  const npcs: NpcState[] = [];
  for (let index = 0; index < 48; index++) {
    const npc = new NpcState();
    npc.id = `npc-${String(index).padStart(2, '0')}`;
    npc.surfaceId = `surface-${index % 10}`;
    npc.x = 3000 + (index % 8) * 100;
    npc.y = 1000 + Math.floor(index / 8) * 100;
    room.state.npcs.set(npc.id, npc);
    npcs.push(npc);
  }
  const controller = attachTestVehicleSimulation(room, {physics});
  for (const car of cars) room.playerControl.register(car.driverId);
  let contactTicks = 0;
  let coldCost = 0;
  let costMicros = 0;

  // Full throttle in tight circles keeps every vehicle clear of the border walls
  // for the whole run.
  for (let tick = 0; tick < 300; tick++) {
    controller.beginTick();
    cars.forEach((car, index) => {
      room.playerControl.setMove(car.driverId, {x: index % 2 === 0 ? 1 : -1, y: -1});
      controller.update(car, DT, tick * 33);
    });
    npcs.forEach((npc, index) => {
      if (index < 10) {
        npc.x = cars[index].x + 10;
        npc.y = cars[index].y;
      } else {
        npc.x += index % 2 === 0 ? 0.5 : -0.5;
        npc.y += index % 3 === 0 ? 0.25 : -0.25;
      }
    });
    const coldStartedAt = tick === 0 ? performance.now() : undefined;
    const startedAt = process.cpuUsage();
    const result = controller.stepPhysics(DT, tick * 33);
    const cost = process.cpuUsage(startedAt);
    costMicros += cost.user + cost.system;
    if (coldStartedAt !== undefined) coldCost = performance.now() - coldStartedAt;
    if (result.contacts > 0) contactTicks++;
  }

  const perTick = costMicros / 1000 / 300;
  physics.free();
  assert.ok(coldCost < 20, `cold surface creation cost ${coldCost.toFixed(3)}ms exceeds 20ms`);
  assert.ok(contactTicks >= 250, `contacts occurred during only ${contactTicks}/300 capacity ticks`);
  assert.ok(perTick < 4, `physics step ${perTick.toFixed(3)}ms/tick exceeds the 4ms capacity budget`);
});

function capacityRoom(): any {
  const room = new DistrictRoom() as any;
  room.world = {
    canOccupy: () => true,
    isBlockedAt: () => false,
    openPointNear: (x: number, y: number) => ({x, y}),
    surfaceAfterMove: (surfaceId: string) => surfaceId,
    surfaces: {manifest: {defaultSurfaceId: 'surface-0'}}
  };
  room.setState(new DistrictState());
  return room;
}

function addDrivenVehicles(room: any, count: number, surfaceCount: number): VehicleState[] {
  const cars: VehicleState[] = [];
  for (let index = 0; index < count; index++) {
    const id = `car-${String(index).padStart(2, '0')}`;
    const driver = new PlayerState();
    driver.id = `driver-${id}`;
    driver.vehicleId = id;
    driver.vehicleSeat = 0;
    const car = new VehicleState();
    car.id = id;
    car.kind = VEHICLE_KINDS[index % VEHICLE_KINDS.length];
    car.driverId = driver.id;
    car.surfaceId = `surface-${index % surfaceCount}`;
    car.x = 1000 + (index % 8) * 250;
    car.y = 1000 + Math.floor(index / 8) * 250;
    room.state.players.set(driver.id, driver);
    room.state.vehicles.set(id, car);
    cars.push(car);
  }
  return cars;
}

function geometry(blockedColumn?: number): PhysicsWorldGeometry {
  const collisions = new Array(GRID * GRID).fill(0);
  if (blockedColumn !== undefined) {
    for (let row = 0; row < GRID; row++) collisions[row * GRID + blockedColumn] = 1;
  }
  return {width: GRID, height: GRID, tileWidth: TILE, tileHeight: TILE, collisions};
}

// Exercises every handling curve: acceleration, sustained turn, brake through
// reverse, slalom, and coast.
function maneuverAt(tick: number): VehicleControlCommand {
  const seconds = tick * DT;
  if (seconds < 3) return {throttle: 1, steering: 0};
  if (seconds < 6) return {throttle: 0.6, steering: 1};
  if (seconds < 8) return {throttle: -1, steering: 0};
  if (seconds < 10) return {throttle: 1, steering: Math.sin(seconds * 2.2)};
  return {throttle: 0, steering: -0.5};
}

function fixture(
  kind: string,
  physics: PhysicsWorld,
  start: {x: number; y: number},
  extras: {acknowledgeInput?: (playerId: string, vehicleId: string, sequence: number) => void} = {}
) {
  const room = new DistrictRoom() as any;
  room.world = {
    canOccupy: () => true,
    isBlockedAt: () => false,
    heightAt: () => 0
  };
  room.setState(new DistrictState());
  const driver = new PlayerState();
  driver.id = 'driver';
  driver.vehicleId = 'car';
  driver.vehicleSeat = 0;
  const car = new VehicleState();
  car.id = 'car';
  car.kind = kind;
  car.driverId = driver.id;
  car.x = start.x;
  car.y = start.y;
  room.state.players.set(driver.id, driver);
  room.state.vehicles.set(car.id, car);
  attachTestVehicleSimulation(room, {physics, ...extras});
  room.playerControl.register(driver.id);
  return {room, car, driver};
}

function driveTick(room: any, car: VehicleState, command: VehicleControlCommand, tick: number): void {
  room.playerControl.setMove(car.driverId, {
    x: command.steering,
    y: -command.throttle,
    handbrake: command.handbrake
  });
  room.vehicleSimulation.beginTick();
  room.vehicleSimulation.update(car, DT, tick * 33);
  room.vehicleSimulation.stepPhysics(DT, tick * 33);
}

function vehicleSlipAngle(vehicle: VehicleState): number {
  const forwardSpeed = vehicle.linvelX * Math.cos(vehicle.angle) + vehicle.linvelY * Math.sin(vehicle.angle);
  const lateralSpeed = vehicle.linvelX * -Math.sin(vehicle.angle) + vehicle.linvelY * Math.cos(vehicle.angle);
  return Math.atan2(lateralSpeed, Math.max(1, Math.abs(forwardSpeed)));
}

function normalizeAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}
