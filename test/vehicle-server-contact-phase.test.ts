import assert from 'node:assert/strict';
import test from 'node:test';
import {DistrictRoom} from '../server/district-room.ts';
import {DistrictState, PlayerState, VehicleState} from '../server/state.ts';
import {vehicleDefinition} from '../shared/content/vehicle-catalog.ts';
import {resolveVehicleDynamicContact} from '../shared/simulation/vehicle-dynamic-contact.ts';
import {
  integrateVehiclePose,
  VEHICLE_SIMULATION_STEP_SECONDS
} from '../shared/simulation/vehicle-step.ts';
import {attachTestVehicleSimulation} from './support/vehicle-simulation.ts';

test('authoritative contacts step every vehicle before resolving stable pairs', () => {
  const fixture = contactFixture(['alpha', 'bravo']);
  const expectedAlpha = integrateVehiclePose(
    pose(fixture.vehicles.alpha),
    {steering: 0, throttle: 0},
    'sedan',
    VEHICLE_SIMULATION_STEP_SECONDS
  );
  const expectedBravo = integrateVehiclePose(
    pose(fixture.vehicles.bravo),
    {steering: 0, throttle: 0},
    'sedan',
    VEHICLE_SIMULATION_STEP_SECONDS
  );
  const expectedContact = resolveVehicleDynamicContact(
    collisionBody('alpha', expectedAlpha),
    collisionBody('bravo', expectedBravo)
  );

  advanceContactTick(fixture, ['alpha', 'bravo']);

  assert.equal(expectedContact.collided, true);
  assert.deepEqual(pose(fixture.vehicles.alpha), {
    x: expectedContact.primaryX,
    y: expectedContact.primaryY,
    angle: expectedAlpha.angle,
    speed: expectedContact.primarySpeed
  });
  assert.deepEqual(pose(fixture.vehicles.bravo), {
    x: expectedContact.otherX,
    y: expectedContact.otherY,
    angle: expectedBravo.angle,
    speed: expectedContact.otherSpeed
  });
  assert.equal(fixture.players.alpha.x, fixture.vehicles.alpha.x);
  assert.equal(fixture.players.bravo.x, fixture.vehicles.bravo.x);
});

test('authoritative contact outcome is independent of map and body update order', () => {
  const forward = contactFixture(['alpha', 'bravo']);
  const reverse = contactFixture(['bravo', 'alpha']);

  advanceContactTick(forward, ['alpha', 'bravo']);
  advanceContactTick(reverse, ['bravo', 'alpha']);

  assert.deepEqual(snapshot(reverse), snapshot(forward));
});

function contactFixture(insertionOrder: readonly VehicleId[]) {
  const room = new DistrictRoom() as any;
  room.world = {canOccupy: () => true};
  room.setState(new DistrictState());
  const players = {
    alpha: player('driver-alpha', 'alpha'),
    bravo: player('driver-bravo', 'bravo')
  };
  const vehicles = {
    alpha: vehicle('alpha', players.alpha.id, 0, 0, 120),
    bravo: vehicle('bravo', players.bravo.id, 62, Math.PI, 120)
  };
  for (const id of insertionOrder) {
    room.state.players.set(players[id].id, players[id]);
    room.state.vehicles.set(id, vehicles[id]);
  }
  attachTestVehicleSimulation(room);
  for (const driver of Object.values(players)) {
    room.playerControl.register(driver.id);
    room.playerControl.setMove(driver.id, {x: 0, y: 0});
  }
  return {room, players, vehicles};
}

function advanceContactTick(
  fixture: ReturnType<typeof contactFixture>,
  updateOrder: readonly VehicleId[]
): void {
  fixture.room.vehicleSimulation.beginTick();
  for (const id of updateOrder) {
    fixture.room.vehicleSimulation.update(
      fixture.vehicles[id],
      VEHICLE_SIMULATION_STEP_SECONDS,
      1000
    );
  }
  fixture.room.vehicleSimulation.finishTick(1000);
}

function player(id: string, vehicleId: VehicleId): PlayerState {
  const state = new PlayerState();
  state.id = id;
  state.vehicleId = vehicleId;
  state.vehicleSeat = 0;
  return state;
}

function vehicle(
  id: VehicleId,
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

function collisionBody(id: VehicleId, state: ReturnType<typeof pose>) {
  const definition = vehicleDefinition('sedan');
  return {
    id,
    ...state,
    halfLength: definition.collision.length / 2,
    halfWidth: definition.collision.width / 2,
    mass: definition.mass,
    damageScale: definition.collisionDamageScale
  };
}

function pose(vehicle: Pick<VehicleState, 'x' | 'y' | 'angle' | 'speed'>) {
  return {
    x: vehicle.x,
    y: vehicle.y,
    angle: vehicle.angle,
    speed: vehicle.speed
  };
}

function snapshot(fixture: ReturnType<typeof contactFixture>) {
  return {
    alpha: pose(fixture.vehicles.alpha),
    bravo: pose(fixture.vehicles.bravo),
    alphaHealth: fixture.vehicles.alpha.health,
    bravoHealth: fixture.vehicles.bravo.health
  };
}

type VehicleId = 'alpha' | 'bravo';
