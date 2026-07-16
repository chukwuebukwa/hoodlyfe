import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PopulationStreamingController,
  STREAMED_CIVILIAN_RECORDS,
  STREAMED_POLICE_RECORDS,
  STREAMED_TRAFFIC_RECORDS
} from '../server/game/population/population-streaming-controller.ts';
import {NpcState, DistrictState} from '../server/state.ts';
import type {CollisionMap, RoadNode, TrafficSpawn} from '../server/world-map.ts';
import {DeterministicRandom} from '../server/game/world/deterministic-random.ts';
import type {TrafficDiagnostic} from '../server/game/traffic/traffic-controller.ts';
import {POPULATION_INTEREST} from '../server/game/population/population-activation-policy.ts';

test('population streaming materializes a bounded nearby subset and virtualizes it when far', () => {
  const fixture = createFixture();
  fixture.controller.initialize(0);
  assert.deepEqual(fixture.controller.diagnostics(), {
    potentialPedestrians: STREAMED_CIVILIAN_RECORDS + STREAMED_POLICE_RECORDS,
    activePedestrians: 0,
    potentialTraffic: STREAMED_TRAFFIC_RECORDS,
    activeTraffic: 0,
    pinnedPedestrians: 0,
    pinnedTraffic: 0,
    jamRetirements: 0,
    hotActors: 0,
    warmActors: 0,
    dormantActors: STREAMED_CIVILIAN_RECORDS + STREAMED_POLICE_RECORDS + STREAMED_TRAFFIC_RECORDS,
    deferredVisibleActors: 0
  });

  fixture.controller.update([{x: 0, y: 0}], 100);
  assert.ok(fixture.state.npcs.size > 0 && fixture.state.npcs.size <= 5);
  assert.ok(fixture.state.vehicles.size > 0 && fixture.state.vehicles.size <= 5);
  assert.equal(fixture.registered.length, fixture.state.vehicles.size);
  assert.equal(fixture.controller.diagnostics().activePedestrians, fixture.state.npcs.size);
  assert.equal(fixture.controller.diagnostics().activeTraffic, fixture.state.vehicles.size);
  for (const actor of [...fixture.state.npcs.values(), ...fixture.state.vehicles.values()]) {
    const distance = Math.hypot(actor.x, actor.y);
    assert.ok(distance > POPULATION_INTEREST.protectedViewRadius);
    assert.ok(distance <= POPULATION_INTEREST.prewarmRadius);
  }
  assert.equal(fixture.controller.diagnostics().hotActors, 0);
  assert.equal(
    fixture.controller.diagnostics().warmActors,
    fixture.state.npcs.size + fixture.state.vehicles.size
  );
  assert.ok(fixture.controller.diagnostics().deferredVisibleActors > 0);

  fixture.controller.update([{x: 10_000, y: 10_000}], 200);
  assert.equal(fixture.state.npcs.size, 0);
  assert.equal(fixture.state.vehicles.size, 0);
  assert.equal(fixture.released.length, fixture.registered.length);
  assert.equal(fixture.controller.diagnostics().activePedestrians, 0);
  assert.equal(fixture.controller.diagnostics().activeTraffic, 0);
});

test('combat pedestrians and damaged traffic remain pinned outside every player cell', () => {
  const fixture = createFixture();
  fixture.controller.initialize(0);
  fixture.controller.update([{x: 0, y: 0}], 100);
  const pinnedNpc = [...fixture.state.npcs.keys()][0];
  const pinnedVehicle = [...fixture.state.vehicles.values()][0];
  fixture.pinnedPedestrians.add(pinnedNpc);
  pinnedVehicle.damageFront = 1;
  pinnedVehicle.health--;

  fixture.controller.update([{x: 10_000, y: 10_000}], 200);
  assert.equal(fixture.state.npcs.has(pinnedNpc), true);
  assert.equal(fixture.state.vehicles.has(pinnedVehicle.id), true);
  assert.equal(fixture.controller.diagnostics().pinnedPedestrians, 1);
  assert.equal(fixture.controller.diagnostics().pinnedTraffic, 1);
});

test('an actor stays hot while any street player remains nearby', () => {
  const fixture = createFixture();
  fixture.controller.initialize(0);
  fixture.controller.update([{x: 0, y: 0}], 100);
  const protectedVehicle = [...fixture.state.vehicles.values()][0];
  assert.ok(protectedVehicle);

  fixture.controller.update([
    {x: 10_000, y: 10_000},
    {x: protectedVehicle.x, y: protectedVehicle.y}
  ], 200);
  assert.equal(fixture.state.vehicles.has(protectedVehicle.id), true);
  assert.ok(fixture.controller.diagnostics().hotActors > 0);
});

test('sustained invisible ambient traffic jams retire blockers without popping visible cars', () => {
  const fixture = createFixture();
  fixture.controller.initialize(0);
  fixture.controller.update([{x: 0, y: 0}], 100);
  const [blocker, follower] = [...fixture.state.vehicles.values()];
  blocker.speed = 0;
  blocker.damageFront = 12;
  blocker.health -= 12;
  follower.speed = 0;
  fixture.trafficDiagnostics.set(blocker.id, {
    speedReason: 'blocked',
    obstacleId: ''
  });
  fixture.trafficDiagnostics.set(follower.id, {
    speedReason: 'vehicle',
    obstacleId: blocker.id
  });

  const invisibleAnchor = {x: blocker.x + 1_540, y: blocker.y};
  fixture.controller.update([invisibleAnchor], 1_000);
  fixture.controller.update([invisibleAnchor], 20_000);
  assert.equal(fixture.state.vehicles.has(blocker.id), false);
  assert.equal(fixture.state.vehicles.has(follower.id), true);
  assert.equal(fixture.controller.diagnostics().jamRetirements, 1);
  assert.equal(fixture.released.includes(blocker.id), true);
});

test('jam retirement never removes traffic inside a player replication radius', () => {
  const fixture = createFixture();
  fixture.controller.initialize(0);
  fixture.controller.update([{x: 0, y: 0}], 100);
  const blocker = [...fixture.state.vehicles.values()][0];
  blocker.speed = 0;
  fixture.trafficDiagnostics.set(blocker.id, {
    speedReason: 'blocked',
    obstacleId: ''
  });

  fixture.controller.update([{x: 1_500, y: 0}], 1_000);
  fixture.controller.update([{x: 1_500, y: 0}], 20_000);
  assert.equal(fixture.state.vehicles.has(blocker.id), true);
  assert.equal(fixture.controller.diagnostics().jamRetirements, 0);
});

function createFixture() {
  const state = new DistrictState();
  const pinnedPedestrians = new Set<string>();
  const registered: string[] = [];
  const released: string[] = [];
  const trafficDiagnostics = new Map<
    string,
    Pick<TrafficDiagnostic, 'speedReason' | 'obstacleId'>
  >();
  const world = {
    tileWidth: 64,
    tileHeight: 64,
    openPoint: (index: number) => ({x: (index - 5_000) * 4, y: 0}),
    pedestrianSpawn: (index: number) => ({x: (index - 5_000) * 4, y: 0}),
    openPointNear: (x: number, y: number) => ({x: x + 64, y}),
    trafficSpawn: (index: number): TrafficSpawn => {
      const column = Math.round((index - 10_000) / 193) * 2;
      return {
        x: column * 64,
        y: 0,
        column,
        row: 0,
        targetColumn: column + 1,
        targetRow: 0,
        angle: 0
      };
    },
    roadNeighbors: (column: number, row: number): RoadNode[] => [
      {column: column - 1, row},
      {column: column + 1, row}
    ],
    roadPoint: (node: RoadNode) => ({x: node.column * 64, y: node.row * 64}),
    nearestRoadNode: (x: number, y: number) => ({
      column: Math.round(x / 64),
      row: Math.round(y / 64)
    }),
    canOccupy: () => true,
    isRoadAt: () => true
  } as unknown as CollisionMap;
  const pedestrians = {
    spawnAmbientAt: (id: string, kind: 'civilian' | 'police', x: number, y: number, angle: number) => {
      const npc = new NpcState();
      npc.id = id;
      npc.kind = kind;
      npc.x = x;
      npc.y = y;
      npc.angle = angle;
      state.npcs.set(id, npc);
      return npc;
    },
    canStreamOut: (id: string) => state.npcs.has(id) && !pinnedPedestrians.has(id),
    streamOutAmbient: (id: string) => {
      if (pinnedPedestrians.has(id)) return false;
      return state.npcs.delete(id);
    }
  };
  const controller = new PopulationStreamingController({
    state,
    world,
    random: new DeterministicRandom('population-test'),
    pedestrians,
    traffic: {
      register: (id: string) => registered.push(id),
      release: (id: string) => released.push(id),
      spawn: (index: number, radius: number) => world.trafficSpawn(index, radius),
      advanceVirtual: (spawn: TrafficSpawn) => ({
        ...spawn,
        x: spawn.x + 64,
        column: spawn.targetColumn,
        targetColumn: spawn.targetColumn + 1
      }),
      captureVirtual: (vehicle: {x: number; y: number; angle: number}) => ({
        ...world.trafficSpawn(Math.round(vehicle.x + vehicle.y), 20),
        x: vehicle.x,
        y: vehicle.y,
        angle: vehicle.angle
      }),
      diagnostics: () => [...trafficDiagnostics.entries()].map(([vehicleId, diagnostic]) => ({
        vehicleId,
        mission: 'cruise-route' as const,
        drivingStyle: 'lawful' as const,
        cruiseSpeed: 100,
        desiredSpeed: 0,
        speedReason: diagnostic.speedReason,
        obstacleId: diagnostic.obstacleId,
        obstacleDistance: 0,
        timeToContactSeconds: -1,
        blockedSince: 0,
        recoveryCount: 0,
        deadlockCycleId: '',
        deadlockCycleSize: 0,
        deadlockRecovering: false,
        deadlockRecoveryCount: 0,
        maneuverPhase: 'none' as const,
        maneuverAttempts: 0,
        emergencyYieldPhase: 'none' as const,
        emergencyVehicleId: '',
        junctionId: '',
        junctionPhase: 'none' as const,
        junctionQueuePosition: 0,
        junctionLeaseExpiresAt: 0,
        routeSource: 'road-cell-fallback' as const,
        currentLaneNodeId: '',
        destinationLaneNodeId: '',
        routeRemaining: 1,
        routeRevision: 0,
        routeComplete: false,
        routeVisited: 1,
        routeWaypoints: []
      }))
    }
  });
  return {state, controller, registered, released, pinnedPedestrians, trafficDiagnostics};
}
