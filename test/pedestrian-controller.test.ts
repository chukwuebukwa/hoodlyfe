import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PedestrianController,
  type PedestrianPoliceTarget
} from '../server/game/pedestrians/pedestrian-controller.ts';
import {DeterministicRandom} from '../server/game/world/deterministic-random.ts';
import {DistrictState, PlayerState, VehicleState} from '../server/state.ts';
import {CollisionMap} from '../server/world-map.ts';

test('pedestrian population spawn and wander state are deterministic', () => {
  const world = CollisionMap.load();
  const first = createController(world, 'pedestrian-scenario');
  const second = createController(world, 'pedestrian-scenario');

  for (let index = 0; index < 10; index++) {
    first.controller.spawn(`civilian-${index + 1}`, 'civilian', index, 130, 760);
    second.controller.spawn(`civilian-${index + 1}`, 'civilian', index, 130, 760);
  }
  for (let index = 0; index < 3; index++) {
    first.controller.spawn(`police-${index + 1}`, 'police', index + 30, 420, 900);
    second.controller.spawn(`police-${index + 1}`, 'police', index + 30, 420, 900);
  }

  assert.equal(first.state.npcs.size, 13);
  assert.equal([...first.state.npcs.values()].filter((npc) => npc.kind === 'civilian').length, 10);
  assert.equal([...first.state.npcs.values()].filter((npc) => npc.kind === 'police').length, 3);
  for (const npc of first.state.npcs.values()) {
    const matching = second.state.npcs.get(npc.id);
    assert.ok(matching);
    assert.deepEqual(
      {x: npc.x, y: npc.y, angle: npc.angle, health: npc.health},
      {x: matching.x, y: matching.y, angle: matching.angle, health: matching.health}
    );
    assert.equal(world.canOccupy(npc.x, npc.y, 10), true);
  }
});

test('panicked civilian faces away from the current player threat', () => {
  const world = CollisionMap.load();
  const {controller, state} = createController(world, 'panic-scenario');
  const civilian = controller.spawn('civilian', 'civilian', 5, 130, 760);
  const threat = new PlayerState();
  threat.id = 'threat';
  threat.x = civilian.x - 30;
  threat.y = civilian.y;
  state.players.set(threat.id, threat);

  controller.panic(civilian.id, threat.id, 5000);
  controller.update(civilian, 1 / 30, 1000);

  assert.ok(Math.abs(civilian.angle) < 0.0001);
  assert.ok(civilian.x >= threat.x + 30);
});

test('police pursue assigned targets and request rate-limited fire', () => {
  const world = CollisionMap.load();
  let target: PedestrianPoliceTarget | undefined;
  const firedAt: number[] = [];
  const {controller} = createController(
    world,
    'police-scenario',
    () => target,
    (_officerId, _x, _y, _angle, nowMs) => firedAt.push(nowMs)
  );
  const police = controller.spawn('police', 'police', 31, 420, 900);
  target = {
    pursuit: {
      officerId: police.id,
      suspectId: 'suspect',
      lastKnownX: police.x + 200,
      lastKnownY: police.y,
      lastSeenAt: 1000,
      searchUntil: 9000,
      mode: 'pursuit'
    },
    canSeeTarget: true,
    targetDistance: 200
  };

  const initialX = police.x;
  controller.update(police, 1 / 30, 1000);
  controller.update(police, 1 / 30, 1200);
  controller.update(police, 1 / 30, 1680);

  assert.ok(police.x >= initialX);
  assert.deepEqual(firedAt, [1000, 1680]);
});

test('dead pedestrians wait for their deadline and restore archetype health', () => {
  const world = CollisionMap.load();
  const {controller} = createController(world, 'respawn-scenario');
  const police = controller.spawn('police', 'police', 32, 420, 900);
  police.alive = false;
  police.health = 0;
  controller.scheduleRespawn(police.id, 2000);

  controller.update(police, 1 / 30, 1999);
  assert.equal(police.alive, false);
  controller.update(police, 1 / 30, 2000);
  assert.equal(police.alive, true);
  assert.equal(police.health, 100);
  assert.equal(world.canOccupy(police.x, police.y, 10), true);
});

test('carjacking creates a panicked ambient driver beside the vehicle', () => {
  const world = CollisionMap.load();
  const spawned: string[] = [];
  const {controller, state} = createController(
    world,
    'ejected-driver-scenario',
    () => undefined,
    () => undefined,
    (npcId) => spawned.push(npcId)
  );
  const vehicle = new VehicleState();
  vehicle.id = 'traffic-car';
  vehicle.x = world.spawn.x;
  vehicle.y = world.spawn.y;
  vehicle.angle = Math.PI / 2;
  const hijacker = new PlayerState();
  hijacker.id = 'hijacker';
  hijacker.x = vehicle.x;
  hijacker.y = vehicle.y;
  state.players.set(hijacker.id, hijacker);

  const driverId = controller.spawnEjectedDriver(vehicle, hijacker, 5000);
  const driver = state.npcs.get(driverId);

  assert.ok(driver);
  assert.equal(driver.kind, 'civilian');
  assert.equal(driver.health, 50);
  assert.deepEqual(spawned, [driverId]);
  const distanceBefore = Math.hypot(driver.x - hijacker.x, driver.y - hijacker.y);
  controller.update(driver, 1 / 30, 5100);
  assert.ok(Math.hypot(driver.x - hijacker.x, driver.y - hijacker.y) >= distanceBefore);
});

function createController(
  world: CollisionMap,
  seed: string,
  policeTarget: () => PedestrianPoliceTarget | undefined = () => undefined,
  requestPoliceFire: (
    officerId: string,
    x: number,
    y: number,
    angle: number,
    nowMs: number
  ) => void = () => undefined,
  onSpawned: (npcId: string) => void = () => undefined
) {
  const state = new DistrictState();
  let tick = 1;
  const controller = new PedestrianController({
    state,
    world,
    random: new DeterministicRandom(seed),
    clock: () => ({tick: tick++}),
    policeTarget,
    requestPoliceFire,
    onSpawned: (npc) => onSpawned(npc.id)
  });
  return {controller, state};
}
