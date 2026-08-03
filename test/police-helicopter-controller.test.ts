import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PoliceHelicopterController,
  desiredHelicopterAssignments,
  helicoptersRequiredForWanted,
  type PoliceHelicopterTarget
} from '../server/game/police/police-helicopter-controller.ts';
import {DistrictState, PlayerState} from '../server/state.ts';
import type {CollisionMap} from '../server/world-map.ts';

test('helicopter escalation starts at four stars and fairly caps the district at two aircraft', () => {
  assert.equal(helicoptersRequiredForWanted(3), 0);
  assert.equal(helicoptersRequiredForWanted(4), 1);
  assert.equal(helicoptersRequiredForWanted(5), 2);

  assert.deepEqual(desiredHelicopterAssignments([
    target('alpha', 5),
    target('bravo', 4)
  ], 2), ['alpha', 'bravo']);
  assert.deepEqual(desiredHelicopterAssignments([
    target('alpha', 5)
  ], 2), ['alpha', 'alpha']);
});

test('authoritative helicopter searches last-known position, reacquires with its light, and departs', () => {
  const state = new DistrictState();
  const player = new PlayerState();
  player.id = 'alpha';
  player.spaceId = 'street';
  player.wanted = 4;
  player.x = 590;
  player.y = 520;
  state.players.set(player.id, player);

  let currentTarget: PoliceHelicopterTarget | undefined = {
    ...target('alpha', 4),
    awareness: 'searching',
    currentX: player.x,
    currentY: player.y,
    lastKnownX: 500,
    lastKnownY: 500
  };
  const observations: boolean[] = [];
  const controller = new PoliceHelicopterController({
    state,
    world: openWorld(),
    targets: () => currentTarget ? [currentTarget] : [],
    reportObservation: (_suspectId, canSeeTarget) => observations.push(canSeeTarget),
    policy: {
      initialSpawnDelayMs: 1,
      reinforcementIntervalMs: 10,
      spawnDistance: 240,
      cruiseAltitude: 120,
      standoffDistance: 150,
      approachDistance: 200,
      maximumSpeed: 220,
      searchSweepRadius: 40,
      spotlightRadius: 120,
      departAltitude: 145
    }
  });

  controller.update(1 / 30, 0);
  assert.equal(state.policeHelicopters.size, 0);
  controller.update(1 / 30, 1);
  assert.equal(state.policeHelicopters.size, 1);
  const helicopter = [...state.policeHelicopters.values()][0];
  assert.equal(helicopter.suspectId, 'alpha');

  controller.update(0.5, 501);
  controller.update(0.5, 1_001);
  assert.equal(helicopter.phase, 'search');
  assert.ok(Math.hypot(helicopter.spotlightX - 500, helicopter.spotlightY - 500) < 60);
  assert.ok(Math.hypot(helicopter.spotlightX - player.x, helicopter.spotlightY - player.y) > 20);

  currentTarget = {...currentTarget, awareness: 'spotted'};
  for (let index = 0; index < 40; index++) controller.update(0.1, 1_100 + index * 100);
  assert.equal(helicopter.phase, 'track');
  assert.ok(observations.includes(true), 'Expected the moving spotlight to reacquire the suspect.');
  assert.equal(controller.searchZonesFor('alpha')[0]?.unitKind, 'helicopter');

  currentTarget = undefined;
  controller.update(0.1, 5_000);
  assert.equal(helicopter.phase, 'depart');
  for (let index = 0; index < 10 && state.policeHelicopters.size > 0; index++) {
    controller.update(0.1, 5_100 + index * 100);
  }
  assert.equal(state.policeHelicopters.size, 0);
});

test('helicopter visibility rays run on a bounded cadence instead of every simulation tick', () => {
  const state = new DistrictState();
  const player = new PlayerState();
  player.id = 'alpha';
  player.spaceId = 'street';
  player.wanted = 4;
  player.x = 500;
  player.y = 500;
  state.players.set(player.id, player);
  let lineOfSightChecks = 0;
  const controller = new PoliceHelicopterController({
    state,
    world: openWorld(() => {
      lineOfSightChecks++;
      return true;
    }),
    targets: () => [target('alpha', 4)],
    reportObservation: () => {},
    policy: {
      initialSpawnDelayMs: 1,
      spawnDistance: 120,
      approachDistance: 200,
      spotlightRadius: 180,
      visibilityCheckIntervalMs: 100
    }
  });

  controller.update(1 / 60, 0);
  controller.update(1 / 60, 1);
  for (let index = 1; index <= 60; index++) {
    controller.update(1 / 60, 1 + index * (1_000 / 60));
  }

  assert.ok(lineOfSightChecks > 0);
  assert.ok(lineOfSightChecks <= 10, `Expected at most 10 rays, got ${lineOfSightChecks}.`);
});

test('helicopter flight state advances at 15 Hz while the simulation ticks at 30 Hz', () => {
  const state = new DistrictState();
  const player = new PlayerState();
  player.id = 'alpha';
  player.spaceId = 'street';
  player.wanted = 4;
  player.x = 500;
  player.y = 500;
  state.players.set(player.id, player);
  const controller = new PoliceHelicopterController({
    state,
    world: openWorld(),
    targets: () => [target('alpha', 4)],
    reportObservation: () => {},
    policy: {initialSpawnDelayMs: 1, flightUpdateIntervalMs: 1_000 / 15}
  });

  controller.update(1 / 30, 0);
  controller.update(1 / 30, 1);
  const helicopter = [...state.policeHelicopters.values()][0];
  const firstX = helicopter.x;
  controller.update(1 / 30, 34);
  assert.equal(helicopter.x, firstX);
  controller.update(1 / 30, 67);
  assert.notEqual(helicopter.x, firstX);
});

function target(suspectId: string, wantedLevel: number): PoliceHelicopterTarget {
  return {
    suspectId,
    wantedLevel,
    awareness: 'spotted',
    currentX: 500,
    currentY: 500,
    lastKnownX: 500,
    lastKnownY: 500
  };
}

function openWorld(hasLineOfSight: () => boolean = () => true): CollisionMap {
  return {
    width: 32,
    height: 32,
    tileWidth: 64,
    tileHeight: 64,
    hasLineOfSight
  } as unknown as CollisionMap;
}
