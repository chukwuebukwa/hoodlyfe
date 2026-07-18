import assert from 'node:assert/strict';
import test from 'node:test';
import {GameEventStream} from '../server/game/events/game-events.ts';
import {PoliceStingerController} from '../server/game/police/police-stinger-controller.ts';
import type {PoliceRoadblockDeployment} from '../server/game/police/police-roadblock-controller.ts';
import {RoadClosureRegistry} from '../server/game/traffic/road-closure-registry.ts';
import {DistrictState, NpcState, VehicleState} from '../server/state.ts';
import {VEHICLE_TYRE_MASK} from '../shared/simulation/vehicle-tyre-state.ts';

test('stinger owns deployment, swept tyre contact, closure overlap, and teardown', () => {
  const state = new DistrictState();
  const closures = new RoadClosureRegistry();
  const events = new GameEventStream();
  const deployment = roadblockDeployment();
  const released: string[] = [];
  let tick = 1;
  const controller = new PoliceStingerController({
    state,
    roadblocks: () => [deployment],
    closures,
    events,
    clock: () => ({tick}),
    pedestrians: {
      spawnOwnedAt: (id, kind, x, y, angle, action) => {
        const npc = new NpcState();
        Object.assign(npc, {id, kind, x, y, angle, action});
        state.npcs.set(id, npc);
        return npc;
      },
      releaseOwned: (id) => {
        released.push(id);
        return true;
      }
    }
  });
  const vehicle = new VehicleState();
  Object.assign(vehicle, {id: 'runner', x: -80, y: 0, angle: 0, speed: 260});
  state.vehicles.set(vehicle.id, vehicle);

  controller.update(0);
  const stingerId = `police-stinger:${deployment.roadblockId}`;
  assert.equal(state.stingers.get(stingerId)?.phase, 'preparing');
  assert.equal(state.stingers.get(stingerId)?.activeSegmentCount, 0);
  assert.equal(closures.owns(stingerId), true);
  assert.equal(controller.ownsOfficer(`${stingerId}:officer`), true);

  controller.update(390);
  controller.update(1_640);
  assert.equal(state.stingers.get(stingerId)?.activeSegmentCount, 6);
  controller.update(2_890);
  assert.equal(state.stingers.get(stingerId)?.phase, 'deployed');
  assert.equal(state.stingers.get(stingerId)?.activeSegmentCount, 12);

  vehicle.x = 80;
  tick++;
  controller.update(2_923);
  assert.equal(vehicle.tyreDamageMask, VEHICLE_TYRE_MASK.all);
  assert.equal(controller.diagnostics()[0].contacts, 1);
  assert.deepEqual(events.drain().map(({type}) => type), [
    'police.stinger-deployed',
    'vehicle.tyres-burst'
  ]);

  deployment.phase = 'retiring';
  controller.update(3_000);
  assert.equal(state.stingers.get(stingerId)?.phase, 'retiring');
  assert.equal(closures.owns(stingerId), true);
  controller.update(5_500);
  assert.equal(state.stingers.has(stingerId), false);
  assert.equal(closures.owns(stingerId), false);
  assert.deepEqual(released, [`${stingerId}:officer`]);
  assert.equal(events.drain().at(-1)?.type, 'police.stinger-cleared');
});

test('stinger does not redeploy when its officer dies before the roadblock retires', () => {
  const state = new DistrictState();
  const closures = new RoadClosureRegistry();
  const deployment = roadblockDeployment();
  let spawnCount = 0;
  const controller = new PoliceStingerController({
    state,
    roadblocks: () => [deployment],
    closures,
    events: new GameEventStream(),
    clock: () => ({tick: 1}),
    pedestrians: {
      spawnOwnedAt: (id, kind, x, y, angle, action) => {
        spawnCount++;
        const npc = new NpcState();
        Object.assign(npc, {id, kind, x, y, angle, action});
        state.npcs.set(id, npc);
        return npc;
      },
      releaseOwned: () => true
    }
  });
  const stingerId = `police-stinger:${deployment.roadblockId}`;

  controller.update(0);
  controller.update(390);
  controller.update(2_890);
  const officer = state.npcs.get(`${stingerId}:officer`);
  assert.ok(officer);
  officer.alive = false;

  controller.update(3_000);
  controller.update(5_500);
  controller.update(6_000);

  assert.equal(state.stingers.has(stingerId), false);
  assert.equal(closures.owns(stingerId), false);
  assert.equal(spawnCount, 1);
});

function roadblockDeployment(): PoliceRoadblockDeployment {
  return {
    roadblockId: 'roadblock-1',
    slotId: 'slot-1',
    suspectId: 'suspect',
    phase: 'deployed',
    blockedEdgeIds: ['edge-a'],
    stinger: {
      x: 0,
      y: 0,
      angle: Math.PI / 2,
      officerPose: {x: 0, y: -72, angle: Math.PI / 2}
    }
  };
}
