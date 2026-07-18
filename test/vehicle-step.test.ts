import assert from 'node:assert/strict';
import test from 'node:test';
import {DistrictRoom} from '../server/district-room.ts';
import {DistrictState, PlayerState, VehicleState} from '../server/state.ts';
import {VEHICLE_KINDS, type VehicleKind} from '../shared/content/vehicle-catalog.ts';
import {
  integrateVehiclePose,
  VEHICLE_SIMULATION_STEP_SECONDS,
  vehicleMechanicalStepModifiers
} from '../shared/simulation/vehicle-step.ts';
import {VEHICLE_TYRE} from '../shared/simulation/vehicle-tyre-state.ts';
import {predictVehiclePose} from '../src/game/prediction/vehicle-prediction-policy.ts';
import {attachTestVehicleSimulation} from './support/vehicle-simulation.ts';

test('shared vehicle step and browser adapter stay identical over a 10,000-step trace', () => {
  for (const kind of VEHICLE_KINDS) {
    let shared = {x: 100, y: 200, angle: 0.25, speed: 0};
    let browser = {...shared};
    for (let tick = 0; tick < 2_000; tick++) {
      const steering = (((tick * 37) % 201) - 100) / 100;
      const throttle = tick % 173 < 19 ? -1 : tick % 97 < 72 ? 1 : 0;
      const modifiers = vehicleMechanicalStepModifiers(
        (tick * 11) % 251,
        tick % 401 < 13,
        tick % 509 < 29 ? VEHICLE_TYRE.frontLeft : 0
      );
      shared = integrateVehiclePose(
        shared,
        {steering, throttle},
        kind,
        VEHICLE_SIMULATION_STEP_SECONDS,
        modifiers
      );
      browser = predictVehiclePose(
        browser,
        {x: steering, y: -throttle},
        kind,
        VEHICLE_SIMULATION_STEP_SECONDS,
        modifiers
      );
      assert.deepEqual(browser, shared, `${kind} diverged at tick ${tick}`);
    }
  }
});

test('authoritative vehicle controller consumes the shared step without drift', () => {
  for (const kind of VEHICLE_KINDS) assertAuthoritativeParity(kind);
});

test('shared vehicle step fails closed on non-finite commands and modifiers', () => {
  const pose = integrateVehiclePose(
    {x: 12, y: 34, angle: Number.NaN, speed: Number.POSITIVE_INFINITY},
    {steering: Number.NaN, throttle: Number.NEGATIVE_INFINITY},
    'sedan',
    Number.NaN,
    {maximumSpeedMultiplier: Number.NaN}
  );
  assert.deepEqual(pose, {x: 12, y: 34, angle: 0, speed: 0});
});

test('burst tyres reduce performance and asymmetric damage creates deterministic pull', () => {
  const healthy = vehicleMechanicalStepModifiers(0, false, 0);
  const frontLeft = vehicleMechanicalStepModifiers(0, false, VEHICLE_TYRE.frontLeft);
  const bothFront = vehicleMechanicalStepModifiers(
    0,
    false,
    VEHICLE_TYRE.frontLeft | VEHICLE_TYRE.frontRight
  );
  assert.ok(frontLeft.maximumSpeedMultiplier < healthy.maximumSpeedMultiplier);
  assert.ok(bothFront.maximumSpeedMultiplier < frontLeft.maximumSpeedMultiplier);
  assert.ok(frontLeft.steeringBias < 0);
  assert.equal(bothFront.steeringBias, 0);

  const pulled = integrateVehiclePose(
    {x: 0, y: 0, angle: 0, speed: 180},
    {steering: 0, throttle: 1},
    'sedan',
    VEHICLE_SIMULATION_STEP_SECONDS,
    frontLeft
  );
  assert.ok(pulled.angle < 0);
});

function assertAuthoritativeParity(kind: VehicleKind): void {
  const room = new DistrictRoom() as any;
  room.world = {canOccupy: () => true};
  room.setState(new DistrictState());
  const player = new PlayerState();
  player.id = `driver-${kind}`;
  player.vehicleId = `vehicle-${kind}`;
  player.vehicleSeat = 0;
  room.state.players.set(player.id, player);
  const vehicle = new VehicleState();
  vehicle.id = player.vehicleId;
  vehicle.kind = kind;
  vehicle.driverId = player.id;
  vehicle.x = 500;
  vehicle.y = 400;
  room.state.vehicles.set(vehicle.id, vehicle);
  attachTestVehicleSimulation(room);
  room.playerControl.register(player.id);

  let expected = {x: vehicle.x, y: vehicle.y, angle: vehicle.angle, speed: vehicle.speed};
  for (let tick = 1; tick <= 600; tick++) {
    const steering = (((tick * 29) % 101) - 50) / 50;
    const throttle = tick % 89 < 12 ? -1 : tick % 61 < 48 ? 1 : 0;
    vehicle.engineDamage = (tick * 7) % 251;
    vehicle.onFire = tick % 307 < 9;
    vehicle.tyreDamageMask = tick % 173 < 11 ? VEHICLE_TYRE.rearRight : 0;
    const modifiers = vehicleMechanicalStepModifiers(
      vehicle.engineDamage,
      vehicle.onFire,
      vehicle.tyreDamageMask
    );
    expected = integrateVehiclePose(
      expected,
      {steering, throttle},
      kind,
      VEHICLE_SIMULATION_STEP_SECONDS,
      modifiers
    );
    room.playerControl.setMove(player.id, {x: steering, y: -throttle});
    room.vehicleSimulation.beginTick();
    room.vehicleSimulation.update(
      vehicle,
      VEHICLE_SIMULATION_STEP_SECONDS,
      tick * VEHICLE_SIMULATION_STEP_SECONDS * 1_000
    );
    assert.deepEqual(
      {x: vehicle.x, y: vehicle.y, angle: vehicle.angle, speed: vehicle.speed},
      expected,
      `${kind} authoritative controller diverged at tick ${tick}`
    );
  }
}
