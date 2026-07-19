import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PedestrianController,
  type PedestrianPoliceTarget
} from '../server/game/pedestrians/pedestrian-controller.ts';
import {DeterministicRandom} from '../server/game/world/deterministic-random.ts';
import {WorldStimulusRegistry} from '../server/game/world/world-stimulus-registry.ts';
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

test('panicked civilian startles toward a threat before fleeing away', () => {
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

  assert.ok(Math.abs(civilian.angle - Math.PI) < 0.0001);
  assert.equal(civilian.action, 'startle');
  const startledX = civilian.x;
  controller.update(civilian, 1 / 30, 1500);
  assert.ok(Math.abs(civilian.angle) < 0.0001);
  assert.equal(civilian.action, 'flee');
  assert.ok(civilian.x > startledX);
  const diagnostic = controller.diagnostics().find((entry) => entry.id === civilian.id);
  assert.ok(diagnostic);
  assert.equal(diagnostic.objective, 'flee');
  assert.equal(diagnostic.reactionPhase, 'respond');
  assert.equal(diagnostic.threatId, threat.id);
  assert.ok(diagnostic.bravery >= 0.22 && diagnostic.bravery <= 0.72);
  assert.equal(diagnostic.stimulusKind, '');
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
    targetDistance: 200,
    wantedLevel: 2,
    tactic: {
      unitId: police.id,
      unitKind: 'foot',
      suspectId: 'suspect',
      role: 'primary',
      phase: 'pursue',
      goalX: police.x + 200,
      goalY: police.y
    }
  };

  const initialX = police.x;
  controller.update(police, 1 / 30, 2000);
  controller.update(police, 1 / 30, 2500);
  controller.update(police, 1 / 30, 3250);

  assert.ok(police.x >= initialX);
  assert.deepEqual(firedAt, [2000, 3250]);
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

test('mission hostile pursues its assigned target, fires, never ambient-respawns, and despawns', () => {
  const world = CollisionMap.load();
  const fired: Array<{actorId: string; weapon: string}> = [];
  const despawned: string[] = [];
  const {controller, state} = createController(
    world,
    'mission-hostile-scenario',
    () => undefined,
    () => undefined,
    () => undefined,
    (actorId, _x, _y, _angle, _nowMs, weapon) => fired.push({actorId, weapon}),
    (npcId) => despawned.push(npcId)
  );
  const player = new PlayerState();
  player.id = 'target';
  player.x = world.spawn.x + 80;
  player.y = world.spawn.y;
  state.players.set(player.id, player);
  const hostile = controller.spawnMissionHostile(
    'hostile',
    world.spawn.x,
    world.spawn.y,
    0,
    0,
    90,
    'smg',
    680,
    1
  );
  controller.assignCombatTarget(hostile.id, player.id);
  controller.update(hostile, 1 / 30, 1_000);
  assert.equal(hostile.kind, 'hostile');
  assert.equal(hostile.action, 'assault');
  assert.deepEqual(fired, [{actorId: hostile.id, weapon: 'smg'}]);

  hostile.alive = false;
  hostile.health = 0;
  controller.scheduleRespawn(hostile.id, 1_100);
  controller.update(hostile, 1 / 30, 5_000);
  assert.equal(hostile.alive, false);
  assert.equal(controller.despawn(hostile.id), true);
  assert.equal(state.npcs.has(hostile.id), false);
  assert.deepEqual(despawned, [hostile.id]);
});

test('mission hostile uses timed point-blank melee instead of firing through its target', () => {
  const world = CollisionMap.load();
  const fired: number[] = [];
  const damage: Array<{amount: number; attackerId: string}> = [];
  const state = new DistrictState();
  const controller = new PedestrianController({
    state,
    world,
    random: new DeterministicRandom('hostile-melee'),
    stimuli: new WorldStimulusRegistry(),
    clock: () => ({tick: 9}),
    policeTarget: () => undefined,
    requestPoliceFire: () => undefined,
    requestHostileFire: (_id, _x, _y, _angle, nowMs) => fired.push(nowMs),
    damagePlayer: (_target, amount, attackerId) => damage.push({amount, attackerId})
  });
  const player = new PlayerState();
  player.id = 'target';
  player.x = world.spawn.x + 40;
  player.y = world.spawn.y;
  state.players.set(player.id, player);
  const hostile = controller.spawnMissionHostile(
    'hostile-melee',
    world.spawn.x,
    world.spawn.y,
    0,
    0,
    90,
    'smg',
    680,
    1
  );
  controller.assignCombatTarget(hostile.id, player.id);

  controller.update(hostile, 1 / 30, 1_000);
  assert.equal(hostile.action, 'melee');
  assert.equal(hostile.attackSequence, 1);
  assert.deepEqual(fired, []);
  controller.update(hostile, 1 / 30, 1_209);
  assert.deepEqual(damage, []);
  controller.update(hostile, 1 / 30, 1_210);
  assert.deepEqual(damage, [{amount: 8, attackerId: hostile.id}]);
  controller.update(hostile, 1 / 30, 1_520);
  assert.equal(hostile.action, 'assault');
  assert.deepEqual(fired, []);
});

test('police request authoritative custody for a visible on-foot pursuit target', () => {
  const world = CollisionMap.load();
  const state = new DistrictState();
  const fired: number[] = [];
  const damage: number[] = [];
  const arrests: Array<{officerId: string; suspectId: string; nowMs: number}> = [];
  let officerId = '';
  const controller = new PedestrianController({
    state,
    world,
    random: new DeterministicRandom('police-melee'),
    stimuli: new WorldStimulusRegistry(),
    clock: () => ({tick: 10}),
    policeTarget: () => ({
      pursuit: {
        officerId,
        suspectId: 'suspect',
        lastKnownX: world.spawn.x + 40,
        lastKnownY: world.spawn.y,
        lastSeenAt: 1_000,
        searchUntil: 9_000,
        mode: 'pursuit'
      },
      canSeeTarget: true,
      targetDistance: 40,
      tactic: {
        unitId: officerId,
        unitKind: 'foot',
        suspectId: 'suspect',
        role: 'primary',
        phase: 'pursue',
        goalX: world.spawn.x + 40,
        goalY: world.spawn.y
      }
    }),
    requestPoliceFire: (_id, _x, _y, _angle, nowMs) => fired.push(nowMs),
    requestPoliceArrest: (requestedOfficerId, suspectId, nowMs) => {
      arrests.push({officerId: requestedOfficerId, suspectId, nowMs});
      return true;
    },
    damagePlayer: (_target, amount) => damage.push(amount)
  });
  const police = controller.spawn('police-melee', 'police', 31, 0, 0);
  police.x = world.spawn.x;
  police.y = world.spawn.y;
  officerId = police.id;
  const player = new PlayerState();
  player.id = 'suspect';
  player.x = world.spawn.x + 40;
  player.y = world.spawn.y;
  player.wanted = 1;
  state.players.set(player.id, player);

  controller.update(police, 1 / 30, 1_000);
  assert.deepEqual(arrests, [{officerId: police.id, suspectId: player.id, nowMs: 1_000}]);
  assert.deepEqual(fired, []);
  controller.update(police, 1 / 30, 1_210);
  assert.deepEqual(damage, []);
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
  assert.equal(driver.ejectedAt, 5000);
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
  onSpawned: (npcId: string) => void = () => undefined,
  requestHostileFire: (
    actorId: string,
    x: number,
    y: number,
    angle: number,
    nowMs: number,
    weapon: 'pistol' | 'smg'
  ) => void = () => undefined,
  onDespawned: (npcId: string) => void = () => undefined
) {
  const state = new DistrictState();
  let tick = 1;
  const controller = new PedestrianController({
    state,
    world,
    random: new DeterministicRandom(seed),
    stimuli: new WorldStimulusRegistry(),
    clock: () => ({tick: tick++}),
    policeTarget,
    requestPoliceFire,
    requestHostileFire,
    onSpawned: (npc) => onSpawned(npc.id),
    onDespawned
  });
  return {controller, state};
}
