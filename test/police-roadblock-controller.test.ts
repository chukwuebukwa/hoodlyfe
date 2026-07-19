import assert from 'node:assert/strict';
import test from 'node:test';
import {districtPoint} from '../shared/content/district-map-frame.ts';
import {GameEventStream} from '../server/game/events/game-events.ts';
import {PoliceRoadblockController} from '../server/game/police/police-roadblock-controller.ts';
import {RoadClosureRegistry} from '../server/game/traffic/road-closure-registry.ts';
import {LaneGraph} from '../server/game/traffic/lane-graph.ts';
import {DistrictState, PlayerState, VehicleState} from '../server/state.ts';
import {CollisionMap} from '../server/world-map.ts';

test('police roadblock closes authored lanes, drains traffic, then deploys authoritative actors', () => {
  const fixture = createFixture();
  fixture.blockingTraffic.push('traffic-1');

  fixture.controller.update(1_000);
  assert.deepEqual(fixture.closures.closedEdgeIds(), [
    'central-avenue:forward:edge:2',
    'central-avenue:forward:lane-1:edge:2',
    'central-avenue:reverse:edge:4',
    'central-avenue:reverse:lane-1:edge:4'
  ]);
  assert.equal(fixture.controller.diagnostics()[0]?.phase, 'clearing');
  assert.equal(roadblockVehicles(fixture.state).length, 0);

  fixture.controller.update(1_050);
  assert.equal(roadblockVehicles(fixture.state).length, 0, 'active traffic must clear first');

  fixture.blockingTraffic.length = 0;
  fixture.controller.update(1_100);
  const vehicles = roadblockVehicles(fixture.state);
  assert.equal(vehicles.length, 2);
  assert.ok(vehicles.every((vehicle) => (
    vehicle.kind === 'police' && vehicle.siren && !vehicle.traffic && vehicle.speed === 0
  )));
  assert.equal(fixture.controller.diagnostics()[0]?.phase, 'deployed');
  assert.equal(fixture.events.drain().filter((event) => event.type === 'police.roadblock-deployed').length, 1);
});

test('roadblock teardown preserves hijacked actors and releases its closure offscreen', () => {
  const fixture = createFixture();
  fixture.controller.update(1_000);
  fixture.controller.update(1_050);
  const vehicles = roadblockVehicles(fixture.state);
  assert.equal(vehicles.length, 2);

  const hijacked = vehicles[0];
  hijacked.driverId = 'other-player';
  fixture.controller.update(1_100);
  assert.equal(fixture.controller.ownsVehicle(hijacked.id), false);
  assert.equal(fixture.state.vehicles.has(hijacked.id), true);
  assert.equal(fixture.controller.diagnostics()[0]?.phase, 'retiring');
  assert.equal(fixture.closures.closedEdgeIds().length, 4);

  fixture.controller.update(1_150);
  assert.equal(fixture.state.vehicles.has(hijacked.id), true);
  assert.equal(roadblockVehicles(fixture.state).length, 1);
  assert.deepEqual(fixture.closures.closedEdgeIds(), []);
  assert.equal(fixture.controller.diagnostics().length, 0);
  const clear = fixture.events.drain().find((event) => event.type === 'police.roadblock-cleared');
  assert.equal(clear && 'reason' in clear ? clear.reason : '', 'breached');
});

test('cleared wanted pressure retires an unseen roadblock and emits lifecycle events', () => {
  const fixture = createFixture();
  fixture.controller.update(1_000);
  fixture.controller.update(1_050);
  fixture.events.drain();

  fixture.player.wanted = 0;
  fixture.controller.update(1_100);
  fixture.controller.update(1_150);

  assert.deepEqual(fixture.closures.closedEdgeIds(), []);
  assert.equal(roadblockVehicles(fixture.state).length, 0);
  const clear = fixture.events.drain().find((event) => event.type === 'police.roadblock-cleared');
  assert.equal(clear && 'reason' in clear ? clear.reason : '', 'wanted-cleared');
});

function createFixture() {
  const state = new DistrictState();
  const player = new PlayerState();
  const suspectStart = districtPoint(2_336, 700);
  player.id = 'suspect';
  player.name = 'Suspect';
  player.x = suspectStart.x;
  player.y = suspectStart.y;
  player.wanted = 3;
  player.vehicleId = 'suspect-car';
  state.players.set(player.id, player);

  const suspectVehicle = new VehicleState();
  suspectVehicle.id = player.vehicleId;
  suspectVehicle.x = player.x;
  suspectVehicle.y = player.y;
  suspectVehicle.angle = Math.PI / 2;
  suspectVehicle.speed = 90;
  suspectVehicle.driverId = player.id;
  state.vehicles.set(suspectVehicle.id, suspectVehicle);

  const world = CollisionMap.load();
  const laneGraph = LaneGraph.load(world);
  const closures = new RoadClosureRegistry();
  const events = new GameEventStream();
  const blockingTraffic: string[] = [];
  const controller = new PoliceRoadblockController({
    state,
    world,
    laneGraph,
    closures,
    responsePlan: () => ({
      desiredUnits: 2,
      targets: [{
        suspectId: player.id,
        wantedLevel: player.wanted,
        x: player.x,
        y: player.y,
        desiredUnits: 2,
        assignedUnits: 0
      }]
    }),
    traffic: {activeVehicleIdsOnEdges: () => [...blockingTraffic]},
    events,
    clock: () => ({tick: 10})
  });
  return {state, player, closures, events, blockingTraffic, controller};
}

function roadblockVehicles(state: DistrictState): VehicleState[] {
  return [...state.vehicles.values()].filter((vehicle) => vehicle.id.startsWith('police-roadblock-'));
}
