import assert from 'node:assert/strict';
import test from 'node:test';
import {DistrictRoom} from '../server/district-room.ts';
import {FreemodeMissionController} from '../server/game/missions/freemode-mission-controller.ts';
import {StreetEconomyController} from '../server/game/economy/street-economy-controller.ts';
import {DistrictState, NpcState, PlayerState, VehicleState} from '../server/state.ts';
import {CollisionMap} from '../server/world-map.ts';
import {attachTestVehicleAccess} from './support/vehicle-access.ts';
import {attachTestTrafficController} from './support/traffic-controller.ts';
import {attachTestVehicleSimulation} from './support/vehicle-simulation.ts';

test('district mission adapter completes shared work, pays once, and releases its target', () => {
  const room = new DistrictRoom() as any;
  room.world = CollisionMap.load();
  room.setState(new DistrictState());
  attachTestTrafficController(room);
  attachTestVehicleAccess(room);
  attachTestVehicleSimulation(room);
  room.state.missionContactX = room.world.spawn.x;
  room.state.missionContactY = room.world.spawn.y;
  room.economyController = new StreetEconomyController({
    state: room.state,
    events: room.events,
    clock: () => ({tick: room.simulationClock.tick})
  });
  room.missionController = new FreemodeMissionController({
    state: room.state,
    world: room.world,
    events: room.events,
    economy: room.economyController,
    clock: () => ({tick: room.simulationClock.tick, nowMs: room.simulationClock.nowMs}),
    notice: () => undefined,
    releaseDeliveredVehicle: (vehicle: VehicleState, nowMs: number) => room.vehicleSimulation.returnToTraffic(
      vehicle,
      nowMs
    )
  });

  const leader = createPlayer('leader', room.world.spawn.x, room.world.spawn.y);
  const support = createPlayer('support', room.world.spawn.x + 24, room.world.spawn.y);
  room.state.players.set(leader.id, leader);
  room.state.players.set(support.id, support);
  room.playerControl.register(leader.id);
  room.playerControl.register(support.id);

  const trafficSpawn = room.world.trafficSpawn(88, 20);
  const target = new VehicleState();
  target.id = 'traffic-mission';
  target.x = trafficSpawn.x;
  target.y = trafficSpawn.y;
  target.angle = trafficSpawn.angle;
  target.traffic = true;
  room.state.vehicles.set(target.id, target);
  room.trafficController.register(target.id, trafficSpawn, 110);

  room.missionController.start(leader.id);
  const missionState = [...room.state.missions.values()][0];
  assert.ok(missionState);
  room.missionController.join(support.id, missionState.id);
  room.missionController.launch(leader.id, missionState.id);
  assert.equal(room.state.missions.get(missionState.id)?.participants.size, 2);
  assert.equal(room.state.missions.get(missionState.id)?.phase, 'steal');

  target.traffic = false;
  target.driverId = support.id;
  support.vehicleId = target.id;
  support.vehicleSeat = 0;
  support.wanted = 1;
  room.missionController.update(1000);
  assert.equal(room.state.missions.get(missionState.id)?.phase, 'lose-heat');

  support.wanted = 0;
  room.missionController.update(1100);
  const deliveryState = room.state.missions.get(missionState.id);
  assert.equal(deliveryState?.phase, 'deliver');
  target.x = deliveryState.deliveryX;
  target.y = deliveryState.deliveryY;
  target.speed = 0;
  room.missionController.update(1200);
  assert.equal(room.state.missions.get(missionState.id)?.phase, 'completed');
  assert.equal(leader.cash, 750);
  assert.equal(support.cash, 750);

  room.missionController.update(1300);
  assert.equal(leader.cash, 750);
  assert.equal(support.cash, 750);
  assert.deepEqual(
    room.events.drain()
      .filter((event: {type: string}) => event.type === 'mission.payout')
      .map((event: {playerId: string; amount: number}) => [event.playerId, event.amount]),
    [['leader', 750], ['support', 750]]
  );

  room.missionController.update(6000);
  assert.equal(room.state.missions.has(missionState.id), false);
  assert.equal(room.missionController.get(missionState.id), undefined);
  assert.equal(target.traffic, true);
  assert.equal(target.driverId, '');
  assert.equal(target.health, target.maxHealth);
  assert.equal(support.vehicleId, '');
});

test('district mission adapter generates and completes an authoritative Getaway Run route', () => {
  const room = new DistrictRoom() as any;
  room.world = CollisionMap.load();
  room.setState(new DistrictState());
  attachTestTrafficController(room);
  attachTestVehicleAccess(room);
  attachTestVehicleSimulation(room);
  room.state.missionContactX = room.world.spawn.x;
  room.state.missionContactY = room.world.spawn.y;
  room.economyController = new StreetEconomyController({
    state: room.state,
    events: room.events,
    clock: () => ({tick: room.simulationClock.tick})
  });
  room.missionController = new FreemodeMissionController({
    state: room.state,
    world: room.world,
    events: room.events,
    economy: room.economyController,
    clock: () => ({tick: room.simulationClock.tick, nowMs: room.simulationClock.nowMs}),
    notice: () => undefined,
    releaseDeliveredVehicle: (vehicle: VehicleState, nowMs: number) => (
      room.vehicleSimulation.returnToTraffic(vehicle, nowMs)
    )
  });

  const leader = createPlayer('leader', room.world.spawn.x, room.world.spawn.y);
  room.state.players.set(leader.id, leader);
  room.playerControl.register(leader.id);
  const spawn = room.world.trafficSpawn(120, 20);
  const target = new VehicleState();
  target.id = 'getaway-target';
  target.x = spawn.x;
  target.y = spawn.y;
  target.angle = spawn.angle;
  target.traffic = true;
  room.state.vehicles.set(target.id, target);
  room.trafficController.register(target.id, spawn, 110);

  room.missionController.start(leader.id, 'getaway-run');
  const schema = [...room.state.missions.values()][0];
  assert.ok(schema);
  assert.equal(schema.templateId, 'getaway-run');
  assert.equal(schema.objectiveCount, 4);
  assert.equal(schema.checkpointCount, 3);
  const runtime = room.missionController.get(schema.id);
  assert.ok(runtime);
  assert.equal(new Set(runtime.checkpoints.map((checkpoint: {x: number; y: number}) => (
    `${checkpoint.x}:${checkpoint.y}`
  ))).size, 3);
  assert.ok(runtime.checkpoints.every((checkpoint: {x: number; y: number}) => (
    room.world.canOccupy(checkpoint.x, checkpoint.y, 20)
  )));

  room.missionController.launch(leader.id, schema.id);
  target.traffic = false;
  target.driverId = leader.id;
  leader.vehicleId = target.id;
  leader.vehicleSeat = 0;
  leader.wanted = 1;
  room.missionController.update(100);
  assert.equal(room.state.missions.get(schema.id)?.phase, 'checkpoints');
  for (const [index, checkpoint] of runtime.checkpoints.entries()) {
    target.x = checkpoint.x;
    target.y = checkpoint.y;
    room.missionController.update(200 + index * 100);
  }
  assert.equal(room.state.missions.get(schema.id)?.phase, 'lose-heat');
  leader.wanted = 0;
  room.missionController.update(600);
  const delivery = room.state.missions.get(schema.id);
  assert.equal(delivery?.phase, 'deliver');
  target.x = delivery.deliveryX;
  target.y = delivery.deliveryY;
  target.speed = 0;
  room.missionController.update(700);
  assert.equal(room.state.missions.get(schema.id)?.phase, 'completed');
  assert.equal(leader.cash, 1_100);
});

test('district mission adapter runs a target-free shared checkpoint job with any crew vehicle', () => {
  const room = new DistrictRoom() as any;
  room.world = CollisionMap.load();
  room.setState(new DistrictState());
  attachTestTrafficController(room);
  attachTestVehicleAccess(room);
  attachTestVehicleSimulation(room);
  room.state.missionContactX = room.world.spawn.x;
  room.state.missionContactY = room.world.spawn.y;
  room.economyController = new StreetEconomyController({
    state: room.state,
    events: room.events,
    clock: () => ({tick: room.simulationClock.tick})
  });
  room.missionController = new FreemodeMissionController({
    state: room.state,
    world: room.world,
    events: room.events,
    economy: room.economyController,
    clock: () => ({tick: room.simulationClock.tick, nowMs: room.simulationClock.nowMs}),
    notice: () => undefined,
    releaseDeliveredVehicle: (vehicle: VehicleState, nowMs: number) => (
      room.vehicleSimulation.returnToTraffic(vehicle, nowMs)
    )
  });

  const leader = createPlayer('leader', room.world.spawn.x, room.world.spawn.y);
  room.state.players.set(leader.id, leader);
  room.playerControl.register(leader.id);
  room.missionController.start(leader.id, 'checkpoint-rush');
  const schema = [...room.state.missions.values()][0];
  const runtime = schema ? room.missionController.get(schema.id) : undefined;
  assert.ok(schema);
  assert.ok(runtime);
  assert.equal(schema.templateId, 'checkpoint-rush');
  assert.equal(schema.targetVehicleId, '');
  assert.equal(schema.objectiveKind, 'crew-checkpoints');
  assert.equal(schema.checkpointCount, 5);
  assert.equal(new Set(runtime.checkpoints.map((checkpoint: {x: number; y: number}) => (
    `${checkpoint.x}:${checkpoint.y}`
  ))).size, 5);
  assert.ok(runtime.checkpoints.every((checkpoint: {x: number; y: number}) => (
    room.world.canOccupy(checkpoint.x, checkpoint.y, 20)
  )));

  const crewCar = new VehicleState();
  crewCar.id = 'crew-car';
  crewCar.driverId = leader.id;
  room.state.vehicles.set(crewCar.id, crewCar);
  leader.vehicleId = crewCar.id;
  leader.vehicleSeat = 0;
  room.missionController.launch(leader.id, schema.id);
  assert.equal(room.state.missions.get(schema.id)?.phase, 'checkpoints');
  for (const [index, checkpoint] of runtime.checkpoints.entries()) {
    crewCar.x = checkpoint.x;
    crewCar.y = checkpoint.y;
    room.missionController.update(100 + index * 100);
  }
  assert.equal(room.state.missions.get(schema.id)?.phase, 'completed');
  assert.equal(leader.cash, 900);
});

test('district mission adapter owns three hostile waves and completes Crew Holdout', () => {
  const room = new DistrictRoom() as any;
  room.world = CollisionMap.load();
  room.setState(new DistrictState());
  attachTestTrafficController(room);
  attachTestVehicleAccess(room);
  attachTestVehicleSimulation(room);
  room.state.missionContactX = room.world.spawn.x;
  room.state.missionContactY = room.world.spawn.y;
  room.economyController = new StreetEconomyController({
    state: room.state,
    events: room.events,
    clock: () => ({tick: room.simulationClock.tick})
  });
  const spawned: string[] = [];
  const targets = new Map<string, string>();
  room.missionController = new FreemodeMissionController({
    state: room.state,
    world: room.world,
    events: room.events,
    economy: room.economyController,
    clock: () => ({tick: room.simulationClock.tick, nowMs: room.simulationClock.nowMs}),
    notice: () => undefined,
    releaseDeliveredVehicle: () => undefined,
    spawnMissionHostile: (spawn) => {
      const npc = new NpcState();
      npc.id = spawn.actorId;
      npc.kind = 'hostile';
      npc.x = spawn.centerX + spawn.minDistance;
      npc.y = spawn.centerY;
      npc.health = spawn.health;
      npc.action = 'assault';
      room.state.npcs.set(npc.id, npc);
      spawned.push(npc.id);
    },
    assignHostileTarget: (actorId, playerId) => targets.set(actorId, playerId),
    despawnMissionNpc: (actorId) => room.state.npcs.delete(actorId)
  });

  const leader = createPlayer('leader', room.world.spawn.x, room.world.spawn.y);
  room.state.players.set(leader.id, leader);
  room.playerControl.register(leader.id);
  room.missionController.start(leader.id, 'crew-holdout');
  const schema = [...room.state.missions.values()][0];
  const runtime = schema ? room.missionController.get(schema.id) : undefined;
  assert.ok(schema);
  assert.ok(runtime);
  assert.equal(schema.templateId, 'crew-holdout');
  assert.equal(schema.holdRequiredMs, 25_000);
  leader.x = runtime.holdX;
  leader.y = runtime.holdY;
  room.missionController.launch(leader.id, schema.id);

  let nowMs = 100;
  for (let step = 0; step < 80; step++) {
    room.missionController.update(nowMs);
    for (const npc of [...room.state.npcs.values()]) {
      if (!npc.alive || npc.kind !== 'hostile') continue;
      assert.equal(targets.get(npc.id), leader.id);
      npc.alive = false;
      npc.health = 0;
      room.events.publish({
        type: 'entity.killed',
        tick: step,
        nowMs,
        entityId: npc.id,
        entityKind: 'npc',
        attackerId: leader.id
      });
    }
    room.missionController.observeEvents(room.events.drain());
    if (room.missionController.get(schema.id)?.encounterComplete) break;
    nowMs += 400;
  }
  assert.equal(spawned.length, 9);
  assert.equal(room.missionController.get(schema.id)?.encounterComplete, true);

  for (let step = 0; step < 30; step++) {
    nowMs += 1_000;
    room.missionController.update(nowMs);
    if (room.missionController.get(schema.id)?.phase === 'completed') break;
  }
  const completed = room.missionController.get(schema.id);
  assert.equal(completed?.phase, 'completed');
  assert.equal(completed?.encounterWave, 3);
  assert.equal(completed?.encounterRemaining, 0);
  assert.equal(completed?.holdProgressMs, 25_000);
  assert.equal(leader.cash, 1_200);
  assert.equal(room.state.npcs.size, 0);
});

test('district mission adapter scales guards, marks one boss, pays, and cleans Most Wanted', () => {
  const room = new DistrictRoom() as any;
  room.world = CollisionMap.load();
  room.setState(new DistrictState());
  room.state.missionContactX = room.world.spawn.x;
  room.state.missionContactY = room.world.spawn.y;
  room.economyController = new StreetEconomyController({
    state: room.state,
    events: room.events,
    clock: () => ({tick: room.simulationClock.tick})
  });
  const roles = new Map<string, string>();
  room.missionController = new FreemodeMissionController({
    state: room.state,
    world: room.world,
    events: room.events,
    economy: room.economyController,
    clock: () => ({tick: room.simulationClock.tick, nowMs: room.simulationClock.nowMs}),
    notice: () => undefined,
    releaseDeliveredVehicle: () => undefined,
    spawnMissionHostile: (spawn) => {
      const npc = new NpcState();
      npc.id = spawn.actorId;
      npc.kind = 'hostile';
      npc.x = spawn.centerX + spawn.minDistance;
      npc.y = spawn.centerY;
      npc.health = spawn.health;
      npc.action = 'assault';
      room.state.npcs.set(npc.id, npc);
      roles.set(npc.id, spawn.role);
    },
    assignHostileTarget: () => undefined,
    despawnMissionNpc: (actorId) => room.state.npcs.delete(actorId)
  });
  const leader = createPlayer('leader', room.world.spawn.x, room.world.spawn.y);
  const support = createPlayer('support', room.world.spawn.x + 20, room.world.spawn.y);
  room.state.players.set(leader.id, leader);
  room.state.players.set(support.id, support);
  room.missionController.start(leader.id, 'most-wanted');
  const schema = [...room.state.missions.values()][0];
  assert.ok(schema);
  room.missionController.join(support.id, schema.id);
  room.missionController.launch(leader.id, schema.id);
  assert.equal(room.state.missions.get(schema.id)?.phase, 'eliminate');

  let nowMs = 0;
  for (let step = 0; step < 50; step++) {
    room.missionController.update(nowMs);
    for (const npc of [...room.state.npcs.values()]) {
      if (!npc.alive) continue;
      npc.alive = false;
      npc.health = 0;
      room.events.publish({
        type: 'entity.killed',
        tick: step,
        nowMs,
        entityId: npc.id,
        entityKind: 'npc',
        attackerId: step % 2 ? support.id : leader.id
      });
    }
    room.missionController.observeEvents(room.events.drain());
    room.missionController.update(nowMs);
    if (room.missionController.get(schema.id)?.phase === 'completed') break;
    nowMs += 400;
  }
  assert.equal([...roles.values()].filter((role) => role === 'guard').length, 3);
  const targetId = `${schema.id}:target`;
  assert.equal(roles.get(targetId), 'target');
  assert.equal(room.state.missions.get(schema.id)?.targetNpcId, targetId);
  assert.equal(room.missionController.get(schema.id)?.phase, 'completed');
  assert.equal(leader.cash, 1_500);
  assert.equal(support.cash, 1_500);
  assert.equal(room.state.npcs.size, 0);
});

function createPlayer(id: string, x: number, y: number): PlayerState {
  const player = new PlayerState();
  player.id = id;
  player.name = id;
  player.x = x;
  player.y = y;
  return player;
}
