import assert from 'node:assert/strict';
import test from 'node:test';
import {DistrictRoom} from '../server/district-room.ts';
import {DistrictState, PlayerState, VehicleState} from '../server/state.ts';
import {vehicleDefinition} from '../shared/content/vehicle-catalog.ts';
import type {VehicleInteractionState} from '../shared/protocol/interaction-contracts.ts';
import {resolveVehicleDynamicContact} from '../shared/simulation/vehicle-dynamic-contact.ts';
import {VEHICLE_SIMULATION_STEP_SECONDS} from '../shared/simulation/vehicle-step.ts';
import type {InteractionIslandBaseline} from '../src/game/prediction/island-state-history.ts';
import {
  replayInteractionIsland,
  type InteractionReplayPairStep
} from '../src/game/prediction/interaction-island-replay.ts';
import {
  createVehicleInteractionBodyStep,
  createVehicleInteractionPairStep
} from '../src/game/prediction/vehicle-interaction-replay.ts';
import {attachTestVehicleSimulation} from './support/vehicle-simulation.ts';

const ONE_WAY_TICKS_AT_150_MS_RTT = 2;
const bodyStep = createVehicleInteractionBodyStep(() => true);
const pairStep = createVehicleInteractionPairStep(() => true);

test('two-car contact prediction matches real authority through 150 ms RTT', () => {
  const authority = authoritativeTrace(36);
  let predictedContactTick = -1;
  let maximumPositionError = 0;
  let maximumSpeedError = 0;
  let maximumErrorAt = 0;
  const trackingPairStep: InteractionReplayPairStep = (left, right, context) => {
    const result = pairStep(left, right, context);
    if (result && predictedContactTick < 0) predictedContactTick = context.serverTick;
    return result;
  };

  for (let currentTick = ONE_WAY_TICKS_AT_150_MS_RTT; currentTick <= 36; currentTick++) {
    const delayed = authority.baselines[currentTick - ONE_WAY_TICKS_AT_150_MS_RTT];
    const prediction = replayInteractionIsland({
      baseline: delayed,
      targetServerTick: currentTick,
      expectedWorldCollisionRevision: delayed.worldCollisionRevision,
      localCommands: commands(delayed.serverTick, currentTick),
      stepBody: bodyStep,
      resolvePair: trackingPairStep
    });
    assert.equal(prediction.replayed, true);
    if (!prediction.replayed) continue;
    const predicted = prediction.entities[0] as VehicleInteractionState;
    const expected = authority.baselines[currentTick].entities[0] as VehicleInteractionState;
    const positionError = Math.hypot(predicted.x - expected.x, predicted.y - expected.y);
    if (positionError > maximumPositionError) {
      maximumPositionError = positionError;
      maximumErrorAt = currentTick;
    }
    maximumSpeedError = Math.max(maximumSpeedError, Math.abs(predicted.speed - expected.speed));
  }

  assert.ok(authority.contactTick > ONE_WAY_TICKS_AT_150_MS_RTT);
  assert.equal(predictedContactTick, authority.contactTick);
  assert.ok(
    maximumPositionError < 1e-9,
    `position error ${maximumPositionError} at tick ${maximumErrorAt}`
  );
  assert.ok(maximumSpeedError < 1e-9, `speed error ${maximumSpeedError}`);
});

function authoritativeTrace(ticks: number): {
  baselines: InteractionIslandBaseline[];
  contactTick: number;
} {
  const fixture = authorityFixture();
  const baselines = [baselineFromAuthority(fixture, 0)];
  let contactTick = -1;
  for (let tick = 1; tick <= ticks; tick++) {
    fixture.room.vehicleSimulation.beginTick();
    fixture.room.vehicleSimulation.update(
      fixture.local,
      VEHICLE_SIMULATION_STEP_SECONDS,
      tick * 1000 / 30
    );
    fixture.room.vehicleSimulation.update(
      fixture.remote,
      VEHICLE_SIMULATION_STEP_SECONDS,
      tick * 1000 / 30
    );
    if (
      contactTick < 0 &&
      resolveVehicleDynamicContact(
        collisionBody(fixture.local),
        collisionBody(fixture.remote)
      ).collided
    ) contactTick = tick;
    fixture.room.vehicleSimulation.finishTick(tick * 1000 / 30);
    baselines.push(baselineFromAuthority(fixture, tick));
  }
  return {baselines, contactTick};
}

function authorityFixture() {
  const room = new DistrictRoom() as any;
  room.world = {canOccupy: () => true};
  room.setState(new DistrictState());
  const localPlayer = player('driver-local', 'local');
  const local = vehicle('local', localPlayer.id, 0, 0, 40);
  const remote = vehicle('remote', '', 62.5, Math.PI, 0);
  remote.destroyed = true;
  remote.respawnAt = Number.MAX_SAFE_INTEGER;
  room.state.players.set(localPlayer.id, localPlayer);
  room.state.vehicles.set(local.id, local);
  room.state.vehicles.set(remote.id, remote);
  attachTestVehicleSimulation(room);
  room.playerControl.register(localPlayer.id);
  room.playerControl.setMove(localPlayer.id, {x: 0, y: 0});
  return {room, local, remote};
}

function baselineFromAuthority(
  fixture: ReturnType<typeof authorityFixture>,
  serverTick: number
): InteractionIslandBaseline {
  return {
    serverTick,
    serverTimeMs: serverTick * 1000 / 30,
    worldCollisionRevision: 1,
    acknowledgedLocalInputSequence: serverTick,
    confirmedEventsThrough: serverTick,
    rootId: 'local',
    entities: [interactionState(fixture.local), interactionState(fixture.remote)],
    remoteIntents: [{
      entityId: 'remote',
      appliedAtServerTick: serverTick,
      moveX: 0,
      moveY: 0,
      steering: 0,
      throttle: 0
    }]
  };
}

function commands(fromTick: number, toTick: number) {
  return Array.from({length: toTick - fromTick}, (_, index) => ({
    serverTick: fromTick + index + 1,
    entityId: 'local',
    moveX: 0,
    moveY: 0,
    steering: 0,
    throttle: 0
  }));
}

function interactionState(vehicle: VehicleState): VehicleInteractionState {
  return {
    id: vehicle.id,
    kind: 'vehicle',
    spaceId: 'street',
    layerId: 'ground',
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
    onFire: vehicle.onFire,
    destroyed: vehicle.destroyed
  };
}

function collisionBody(vehicle: VehicleState) {
  const definition = vehicleDefinition(vehicle.kind);
  return {
    id: vehicle.id,
    x: vehicle.x,
    y: vehicle.y,
    angle: vehicle.angle,
    speed: vehicle.destroyed ? 0 : vehicle.speed,
    halfLength: definition.collision.length / 2,
    halfWidth: definition.collision.width / 2,
    mass: definition.mass * (vehicle.destroyed ? 2.5 : 1),
    damageScale: definition.collisionDamageScale
  };
}

function player(id: string, vehicleId: string): PlayerState {
  const state = new PlayerState();
  state.id = id;
  state.vehicleId = vehicleId;
  state.vehicleSeat = 0;
  return state;
}

function vehicle(
  id: string,
  driverId: string,
  x: number,
  angle: number,
  speed: number
): VehicleState {
  const state = new VehicleState();
  state.id = id;
  state.kind = 'sedan';
  state.driverId = driverId;
  state.x = x;
  state.angle = angle;
  state.speed = speed;
  return state;
}
