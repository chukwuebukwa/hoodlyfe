import assert from 'node:assert/strict';
import test, {before} from 'node:test';
import {DistrictRoom} from '../server/district-room.ts';
import {DistrictState, PlayerState, VehicleState} from '../server/state.ts';
import {VEHICLE_KINDS, vehicleDefinition} from '../shared/content/vehicle-catalog.ts';
import {
  integrateVehiclePose,
  VEHICLE_SIMULATION_STEP_SECONDS,
  type VehicleControlCommand
} from '../shared/simulation/vehicle-step.ts';
import {
  initializePhysicsEngine,
  PhysicsWorld,
  type PhysicsWorldGeometry
} from '../shared/physics/physics-world.ts';
import type {VehicleWorldPose} from '../shared/physics/vehicle-world-collision.ts';
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
    let reference: VehicleWorldPose = {x: car.x, y: car.y, angle: 0, speed: 0};
    let maxPositionError = 0;
    let maxAngleError = 0;
    for (let tick = 0; tick < PARITY_TICKS; tick++) {
      const command = maneuverAt(tick);
      reference = integrateVehiclePose(reference, command, kind, DT);
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

test('physics path acknowledges input sequences and retires undriven bodies', () => {
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
  assert.ok(physics.has(car.id));
  assert.deepEqual(acknowledged, [{vehicleId: car.id, sequence: 7}]);

  car.driverId = '';
  driver.vehicleId = '';
  room.vehicleSimulation.beginTick();
  room.vehicleSimulation.update(car, DT, 100);
  room.vehicleSimulation.stepPhysics(100);
  assert.equal(physics.has(car.id), false);
  physics.free();
});

// Stage-1 acceptance: physics step below 1 ms p95 under a full driven-vehicle load.
test('physics step cost stays under the stage-1 budget with 40 driven vehicles', () => {
  const physics = PhysicsWorld.create(geometry());
  const room = new DistrictRoom() as any;
  room.world = {
    canOccupy: () => true,
    isBlockedAt: () => false,
    openPointNear: (x: number, y: number) => ({x, y})
  };
  room.setState(new DistrictState());
  const cars: VehicleState[] = [];
  for (let index = 0; index < 40; index++) {
    const id = `car-${String(index).padStart(2, '0')}`;
    const driver = new PlayerState();
    driver.id = `driver-${id}`;
    driver.vehicleId = id;
    driver.vehicleSeat = 0;
    const car = new VehicleState();
    car.id = id;
    car.kind = VEHICLE_KINDS[index % VEHICLE_KINDS.length];
    car.driverId = driver.id;
    car.x = 1000 + (index % 8) * 250;
    car.y = 1000 + Math.floor(index / 8) * 250;
    room.state.players.set(driver.id, driver);
    room.state.vehicles.set(id, car);
    cars.push(car);
  }
  const controller = attachTestVehicleSimulation(room, {physics});
  for (const car of cars) room.playerControl.register(car.driverId);

  // Full throttle in tight circles keeps every vehicle clear of the border walls
  // for the whole run.
  for (let tick = 0; tick < 300; tick++) {
    cars.forEach((car, index) => {
      room.playerControl.setMove(car.driverId, {x: index % 2 === 0 ? 1 : -1, y: -1});
    });
    controller.beginTick();
    for (const car of cars) controller.update(car, DT, tick * 33);
    controller.stepPhysics(tick * 33);
  }

  const costs = [...controller.physicsStepCosts()].sort((left, right) => left - right);
  physics.free();
  assert.ok(costs.length >= 300);
  const p95 = costs[Math.floor(costs.length * 0.95)];
  assert.ok(p95 < 1, `physics step p95 ${p95.toFixed(3)}ms exceeds the 1ms stage-1 budget`);
});

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
  room.world = {canOccupy: () => true, isBlockedAt: () => false};
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
  room.playerControl.setMove(car.driverId, {x: command.steering, y: -command.throttle});
  room.vehicleSimulation.beginTick();
  room.vehicleSimulation.update(car, DT, tick * 33);
  room.vehicleSimulation.stepPhysics(tick * 33);
}

function normalizeAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}
