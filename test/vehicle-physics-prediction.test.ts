import assert from 'node:assert/strict';
import test, {before} from 'node:test';
import {DistrictRoom} from '../server/district-room.ts';
import {DistrictState, PlayerState, VehicleState} from '../server/state.ts';
import type {VehicleInteractionState} from '../shared/protocol/interaction-contracts.ts';
import {
  initializePhysicsEngine,
  PhysicsWorld,
  type PhysicsWorldGeometry
} from '../shared/physics/physics-world.ts';
import {
  captureVehicleBody,
  driveVehicleBody
} from '../shared/simulation/vehicle-body-drive.ts';
import {
  VEHICLE_SIMULATION_STEP_SECONDS,
  vehicleMechanicalStepModifiers
} from '../shared/simulation/vehicle-step.ts';
import {replayInteractionIsland} from '../src/game/prediction/interaction-island-replay.ts';
import {continueRemoteIntent} from '../src/game/prediction/remote-intent-continuation.ts';
import {SavedVehiclePrediction} from '../src/game/prediction/saved-vehicle-prediction.ts';
import {
  createVehiclePhysicsBatchStep,
  createVehiclePhysicsPoseStepper
} from '../src/game/prediction/vehicle-physics-replay.ts';
import type {InteractionIslandBaseline} from '../src/game/prediction/island-state-history.ts';
import {attachTestVehicleSimulation} from './support/vehicle-simulation.ts';

const DT = VEHICLE_SIMULATION_STEP_SECONDS;
const GRID = 64;
const TILE = 64;

before(async () => {
  await initializePhysicsEngine();
});

function geometry(blockedColumn?: number): PhysicsWorldGeometry {
  const collisions = new Array(GRID * GRID).fill(0);
  if (blockedColumn !== undefined) {
    for (let row = 0; row < GRID; row++) collisions[row * GRID + blockedColumn] = 1;
  }
  return {width: GRID, height: GRID, tileWidth: TILE, tileHeight: TILE, collisions};
}

function commandAt(tick: number): {steering: number; throttle: number} {
  if (tick < 100) return {steering: 0, throttle: 1};
  if (tick < 150) return {steering: 0.7, throttle: -0.8};
  return {steering: Math.sin(tick * 0.11), throttle: 1};
}

// The stage-2 premise: the client's engine stepper must retrace the server's
// flagged simulation path exactly, including through wall contact.
test('client engine prediction retraces the server physics path bit-for-bit', () => {
  const serverWorld = PhysicsWorld.create(geometry(44));
  const clientWorld = PhysicsWorld.create(geometry(44));

  const room = new DistrictRoom() as any;
  room.world = {canOccupy: () => true, isBlockedAt: () => false};
  room.setState(new DistrictState());
  const driver = new PlayerState();
  driver.id = 'driver';
  driver.vehicleId = 'car';
  driver.vehicleSeat = 0;
  const car = new VehicleState();
  car.id = 'car';
  car.kind = 'sedan';
  car.driverId = 'driver';
  car.x = 2048;
  car.y = 2048;
  room.state.players.set(driver.id, driver);
  room.state.vehicles.set(car.id, car);
  attachTestVehicleSimulation(room, {physics: serverWorld});
  room.playerControl.register(driver.id);

  const prediction = new SavedVehiclePrediction(
    createVehiclePhysicsPoseStepper(() => clientWorld, car.id)
  );
  prediction.initialize({x: car.x, y: car.y, angle: 0, speed: 0});

  let maxDivergence = 0;
  let sawWallContact = false;
  for (let tick = 0; tick < 240; tick++) {
    const command = commandAt(tick);
    // Modifiers as the server will apply them this tick; production clients mirror
    // them from replicated vehicle state.
    const modifiers = vehicleMechanicalStepModifiers(
      car.engineDamage,
      car.onFire,
      car.tyreDamageMask
    );
    room.playerControl.setMove(driver.id, {x: command.steering, y: -command.throttle});
    room.vehicleSimulation.beginTick();
    room.vehicleSimulation.update(car, DT, tick * 33);
    room.vehicleSimulation.stepPhysics(tick * 33);

    const advanced = prediction.advance(
      {x: command.steering, y: -command.throttle},
      car.kind,
      DT,
      () => true,
      modifiers
    );
    maxDivergence = Math.max(
      maxDivergence,
      Math.hypot(advanced.pose.x - car.x, advanced.pose.y - car.y),
      Math.abs(advanced.pose.speed - car.speed)
    );
    if (car.x > 44 * TILE - 80) sawWallContact = true;
  }
  serverWorld.free();
  clientWorld.free();
  assert.ok(sawWallContact, 'scenario never reached the wall, weakening the test');
  assert.ok(
    maxDivergence < 1e-6,
    `client prediction diverged ${maxDivergence} from the server physics path`
  );
});

test('island batch replay matches the shared drive recipe per vehicle and skips the rest', () => {
  const referenceWorld = PhysicsWorld.create(geometry());
  const islandWorld = PhysicsWorld.create(geometry());
  const ticks = 8;
  const baselineTick = 100;

  const rootBase = vehicleEntity('vehicle-root', 2048, 2048);
  const remoteBase = vehicleEntity('vehicle-remote', 2400, 2100);
  const destroyedBase = {...vehicleEntity('vehicle-dead', 2600, 2300), destroyed: true};
  const baseline: InteractionIslandBaseline = {
    serverTick: baselineTick,
    serverTimeMs: baselineTick * 33,
    worldCollisionRevision: 1,
    controlRevision: 1,
    controlMode: 'driver',
    acknowledgedLocalInputSequence: 10,
    confirmedEventsThrough: baselineTick,
    rootId: rootBase.id,
    entities: [rootBase, remoteBase, destroyedBase],
    remoteIntents: [{
      entityId: remoteBase.id,
      appliedAtServerTick: baselineTick,
      moveX: 0,
      moveY: 0,
      steering: 0.4,
      throttle: 0.6,
      movementScale: 1
    }]
  };

  const result = replayInteractionIsland({
    baseline,
    targetServerTick: baselineTick + ticks,
    expectedWorldCollisionRevision: 1,
    localCommands: Array.from({length: ticks}, (_, index) => ({
      serverTick: baselineTick + index + 1,
      entityId: rootBase.id,
      moveX: 0,
      moveY: 0,
      steering: -0.5,
      throttle: 1,
      movementScale: 1
    })),
    stepBody: (entity) => entity,
    stepBatch: createVehiclePhysicsBatchStep(islandWorld),
    resolvePair: undefined
  });
  assert.ok(result.replayed);

  const remoteIntent = baseline.remoteIntents[0];
  const expectations: Array<{
    entity: VehicleInteractionState;
    controlAt: (tick: number, heldSteering: number) => {steering: number; throttle: number};
  }> = [
    {entity: rootBase, controlAt: () => ({steering: -0.5, throttle: 1})},
    {entity: remoteBase, controlAt: (tick, heldSteering) => {
      const control = continueRemoteIntent(remoteIntent, baselineTick + tick + 1);
      return {
        steering: control.source === 'neutral' ? heldSteering : control.steering,
        throttle: control.throttle
      };
    }}
  ];
  for (const expectation of expectations) {
    let pose = {
      x: expectation.entity.x,
      y: expectation.entity.y,
      angle: expectation.entity.angle,
      speed: expectation.entity.speed
    };
    let heldSteering = expectation.entity.steering;
    for (let tick = 0; tick < ticks; tick++) {
      const control = expectation.controlAt(tick, heldSteering);
      heldSteering = control.steering;
      const target = driveVehicleBody(
        referenceWorld,
        expectation.entity.id,
        expectation.entity.vehicleKind,
        pose,
        control,
        DT
      );
      referenceWorld.step();
      pose = captureVehicleBody(referenceWorld, expectation.entity.id, target)!.pose;
    }
    const replayed = result.entities.find(({id}) => id === expectation.entity.id);
    assert.ok(replayed);
    const divergence = Math.hypot(replayed.x - pose.x, replayed.y - pose.y);
    assert.ok(
      divergence < 1e-6,
      `${expectation.entity.id} diverged ${divergence} from the shared recipe`
    );
  }

  const untouched = result.entities.find(({id}) => id === destroyedBase.id);
  assert.ok(untouched);
  assert.equal(untouched.x, destroyedBase.x);
  assert.equal(untouched.y, destroyedBase.y);
  assert.equal(islandWorld.has(destroyedBase.id), false);
  referenceWorld.free();
  islandWorld.free();
});

function vehicleEntity(id: string, x: number, y: number): VehicleInteractionState {
  return {
    id,
    kind: 'vehicle',
    spaceId: 'street',
    layerId: 'ground',
    x,
    y,
    angle: 0,
    velocityX: 0,
    velocityY: 0,
    angularVelocity: 0,
    colliderRevision: 1,
    lifecycleRevision: 1,
    interactionPriority: 'ambient',
    vehicleKind: 'sedan',
    speed: 0,
    steering: 0,
    engineDamage: 0,
    tyreDamageMask: 0,
    onFire: false,
    destroyed: false
  };
}
