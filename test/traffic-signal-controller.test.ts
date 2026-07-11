import assert from 'node:assert/strict';
import test from 'node:test';
import {trafficSignalPhasesAt} from '../shared/content/traffic-signals.ts';
import {TrafficSignalController} from '../server/game/traffic/traffic-signal-controller.ts';
import {DistrictState, VehicleState} from '../server/state.ts';
import {CollisionMap} from '../server/world-map.ts';

test('traffic signal phase clock exposes green, yellow, opposing green, and all-red clearance', () => {
  assert.deepEqual(trafficSignalPhasesAt(0), {
    northSouth: 'green', eastWest: 'red', nextChangeAt: 5_000
  });
  assert.equal(trafficSignalPhasesAt(5_500).northSouth, 'yellow');
  assert.equal(trafficSignalPhasesAt(6_500).eastWest, 'green');
  assert.deepEqual(trafficSignalPhasesAt(12_500), {
    northSouth: 'red', eastWest: 'red', nextChangeAt: 16_000
  });
});

test('signals stop an approaching civilian, release green, and explicitly bypass emergency response', () => {
  const state = new DistrictState();
  const world = CollisionMap.load();
  const nearby: VehicleState[] = [];
  const controller = new TrafficSignalController({
    state,
    world,
    nearbyVehicles: () => nearby
  });
  controller.initialize(0);
  const eastbound = vehicle('eastbound', 2_080, 960, 0);

  assert.equal(controller.obstaclesFor(eastbound, 1_000).length, 1);
  assert.equal(controller.obstaclesFor(eastbound, 7_000).length, 0);
  assert.equal(controller.obstaclesFor(eastbound, 1_000, true).length, 0);
  assert.equal(state.trafficSignals.size, 2);
});

test('green traffic waits until cross-axis occupancy clears', () => {
  const state = new DistrictState();
  const world = CollisionMap.load();
  const crossing = vehicle('crossing', 2_400, 960, 0);
  const controller = new TrafficSignalController({
    state,
    world,
    nearbyVehicles: () => [crossing]
  });
  controller.initialize(0);
  const northbound = vehicle('northbound', 2_400, 1_180, -Math.PI / 2);
  assert.equal(controller.obstaclesFor(northbound, 1_000).length, 1);
});

function vehicle(id: string, x: number, y: number, angle: number): VehicleState {
  const result = new VehicleState();
  result.id = id;
  result.x = x;
  result.y = y;
  result.angle = angle;
  return result;
}
