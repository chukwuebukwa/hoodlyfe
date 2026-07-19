import assert from 'node:assert/strict';
import test from 'node:test';
import {DistrictRoom} from '../server/district-room.ts';
import {DistrictState, PlayerState, VehicleState} from '../server/state.ts';
import type {
  HumanoidInteractionState,
  InteractionEntityState,
  VehicleInteractionState
} from '../shared/protocol/interaction-contracts.ts';
import {ON_FOOT_SIMULATION_STEP_SECONDS} from '../shared/simulation/on-foot-step.ts';
import {PhysicsWorld} from '../shared/physics/physics-world.ts';
import type {InteractionIslandBaseline} from '../src/game/prediction/island-state-history.ts';
import {
  replayInteractionIsland,
} from '../src/game/prediction/interaction-island-replay.ts';
import {createMixedInteractionBodyStep} from '../src/game/prediction/mixed-interaction-replay.ts';
import {createVehiclePhysicsBatchStep} from '../src/game/prediction/vehicle-physics-replay.ts';
import {attachTestVehicleSimulation} from './support/vehicle-simulation.ts';

const ONE_WAY_TICKS_AT_150_MS_RTT = 2;
const STEP = ON_FOOT_SIMULATION_STEP_SECONDS;
const bodyStep = createMixedInteractionBodyStep(() => true);

test('vehicle versus on-foot island replay matches real authority through 150 ms RTT', () => {
  const authority = authoritativeTrace(18);
  let maximumPlayerError = 0;
  let maximumVehicleError = 0;
  let maximumSpeedError = 0;
  const physics = PhysicsWorld.create(geometry());

  for (let currentTick = ONE_WAY_TICKS_AT_150_MS_RTT; currentTick <= 18; currentTick++) {
    const delayed = authority.baselines[currentTick - ONE_WAY_TICKS_AT_150_MS_RTT];
    const prediction = replayInteractionIsland({
      baseline: delayed,
      targetServerTick: currentTick,
      expectedWorldCollisionRevision: delayed.worldCollisionRevision,
      localCommands: commands(delayed.serverTick, currentTick),
      stepBody: bodyStep,
      stepBatch: createVehiclePhysicsBatchStep(physics)
    });
    assert.equal(prediction.replayed, true);
    if (!prediction.replayed) continue;
    const predictedPlayer = prediction.entities.find(({id}) => id === 'local');
    const predictedVehicle = prediction.entities.find(({id}) => id === 'car');
    const expectedPlayer = authority.baselines[currentTick].entities.find(({id}) => id === 'local');
    const expectedVehicle = authority.baselines[currentTick].entities.find(({id}) => id === 'car');
    assert.equal(predictedPlayer?.kind, 'player');
    assert.equal(predictedVehicle?.kind, 'vehicle');
    assert.equal(expectedPlayer?.kind, 'player');
    assert.equal(expectedVehicle?.kind, 'vehicle');
    maximumPlayerError = Math.max(maximumPlayerError, distance(predictedPlayer!, expectedPlayer!));
    maximumVehicleError = Math.max(maximumVehicleError, distance(predictedVehicle!, expectedVehicle!));
    maximumSpeedError = Math.max(
      maximumSpeedError,
      Math.abs(
        (predictedVehicle as VehicleInteractionState).speed -
        (expectedVehicle as VehicleInteractionState).speed
      )
    );
  }

  assert.ok(authority.contactTick > ONE_WAY_TICKS_AT_150_MS_RTT);
  assert.ok(maximumPlayerError < 0.02, `player position error ${maximumPlayerError}`);
  assert.ok(maximumVehicleError < 0.02, `vehicle position error ${maximumVehicleError}`);
  assert.ok(maximumSpeedError < 0.5, `vehicle speed error ${maximumSpeedError}`);
});

function authoritativeTrace(ticks: number): {
  baselines: InteractionIslandBaseline[];
  contactTick: number;
} {
  const fixture = authorityFixture();
  const baselines = [baselineFromAuthority(fixture, 0, 0, 0)];
  let contactTick = -1;
  let previousX = fixture.local.x;
  let previousY = fixture.local.y;
  for (let tick = 1; tick <= ticks; tick++) {
    fixture.room.playerControl.acceptBatch(fixture.local.id, {
      moves: [{sequence: tick, x: 1, y: 0}]
    });
    fixture.room.playerControl.setMove(fixture.driver.id, {x: 0, y: -1, sequence: tick});
    fixture.room.vehicleSimulation.beginTick();
    fixture.room.vehicleSimulation.update(fixture.vehicle, STEP, tick * 1000 / 30);
    fixture.room.playerControl.updateOnFoot(fixture.local, STEP);
    const contacts = fixture.room.vehicleSimulation.stepPhysics(
      STEP,
      tick * 1000 / 30
    );
    if (contacts.contacts > 0 && contactTick < 0) contactTick = tick;
    const velocityX = (fixture.local.x - previousX) / STEP;
    const velocityY = (fixture.local.y - previousY) / STEP;
    previousX = fixture.local.x;
    previousY = fixture.local.y;
    baselines.push(baselineFromAuthority(fixture, tick, velocityX, velocityY));
  }
  return {baselines, contactTick};
}

function authorityFixture() {
  const room = new DistrictRoom() as any;
  room.world = {canOccupy: () => true};
  room.setState(new DistrictState());
  const local = new PlayerState();
  local.id = 'local';
  local.x = 1000;
  local.y = 1000;
  local.spaceId = 'street';
  const driver = new PlayerState();
  driver.id = 'remote-driver';
  driver.vehicleId = 'car';
  driver.vehicleSeat = 0;
  const vehicle = new VehicleState();
  vehicle.id = 'car';
  vehicle.kind = 'sedan';
  vehicle.driverId = driver.id;
  vehicle.x = 1090;
  vehicle.y = 1000;
  vehicle.angle = Math.PI;
  vehicle.speed = 80;
  room.state.players.set(local.id, local);
  room.state.players.set(driver.id, driver);
  room.state.vehicles.set(vehicle.id, vehicle);
  attachTestVehicleSimulation(room);
  room.playerControl.register(local.id);
  room.playerControl.register(driver.id);
  return {room, local, driver, vehicle};
}

function baselineFromAuthority(
  fixture: ReturnType<typeof authorityFixture>,
  serverTick: number,
  localVelocityX: number,
  localVelocityY: number
): InteractionIslandBaseline {
  return {
    serverTick,
    serverTimeMs: serverTick * 1000 / 30,
    worldCollisionRevision: 1,
    controlRevision: 1,
    controlMode: 'on-foot',
    acknowledgedLocalInputSequence: serverTick,
    confirmedEventsThrough: serverTick,
    rootId: fixture.local.id,
    entities: [
      playerState(fixture.local, localVelocityX, localVelocityY),
      vehicleState(fixture.vehicle)
    ],
    remoteIntents: [{
      entityId: fixture.vehicle.id,
      appliedAtServerTick: serverTick,
      moveX: 0,
      moveY: 0,
      steering: 0,
      throttle: 1,
      movementScale: 1
    }]
  };
}

function commands(fromTick: number, toTick: number) {
  return Array.from({length: toTick - fromTick}, (_, index) => ({
    serverTick: fromTick + index + 1,
    entityId: 'local',
    moveX: 1,
    moveY: 0,
    steering: 0,
    throttle: 0,
    movementScale: 1
  }));
}

function playerState(
  player: PlayerState,
  velocityX: number,
  velocityY: number
): HumanoidInteractionState {
  return {
    id: player.id,
    kind: 'player',
    spaceId: player.spaceId,
    layerId: 'ground',
    x: player.x,
    y: player.y,
    angle: player.angle,
    velocityX,
    velocityY,
    angularVelocity: 0,
    colliderRevision: 1,
    lifecycleRevision: 1,
    interactionPriority: 'player-controlled',
    radius: 11,
    movementMode: 'run',
    actionPhase: 'free',
    actionTick: 0,
    surfaceId: player.spaceId,
    alive: player.alive
  };
}

function vehicleState(vehicle: VehicleState): VehicleInteractionState {
  return {
    id: vehicle.id,
    kind: 'vehicle',
    spaceId: 'street',
    layerId: 'ground',
    surfaceId: 'street-ground',
    x: vehicle.x,
    y: vehicle.y,
    angle: vehicle.angle,
    velocityX: Math.cos(vehicle.angle) * vehicle.speed,
    velocityY: Math.sin(vehicle.angle) * vehicle.speed,
    angularVelocity: 0,
    colliderRevision: 1,
    lifecycleRevision: 1,
    interactionPriority: 'player-controlled',
    vehicleKind: 'sedan',
    speed: vehicle.speed,
    steering: 0,
    engineDamage: vehicle.engineDamage,
    tyreDamageMask: vehicle.tyreDamageMask,
    onFire: vehicle.onFire,
    destroyed: vehicle.destroyed
  };
}

function distance(left: InteractionEntityState, right: InteractionEntityState): number {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function geometry() {
  return {
    width: 128,
    height: 128,
    tileWidth: 64,
    tileHeight: 64,
    collisions: new Array(128 * 128).fill(0)
  };
}
