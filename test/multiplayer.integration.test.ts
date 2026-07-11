import assert from 'node:assert/strict';
import {spawn, type ChildProcess} from 'node:child_process';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import test from 'node:test';
import {Client, type Room} from 'colyseus.js';
import {
  DEBUG_SNAPSHOT_MESSAGE,
  DEBUG_SUBSCRIBE_MESSAGE,
  type DebugSnapshot
} from '../shared/protocol/debug.ts';
import {
  MISSION_JOIN_MESSAGE,
  MISSION_LAUNCH_MESSAGE,
  MISSION_START_MESSAGE
} from '../shared/protocol/missions.ts';
import {GAME_NOTICE_MESSAGE} from '../shared/protocol/notices.ts';
import {
  APPEARANCE_RESULT_MESSAGE,
  APPEARANCE_UPDATE_MESSAGE,
  type AppearanceResultMessage
} from '../shared/protocol/appearance.ts';
import {
  WARDROBE_REQUEST_MESSAGE,
  WARDROBE_STATE_MESSAGE,
  type WardrobeStateMessage
} from '../shared/protocol/wardrobe.ts';
import {DEVELOPMENT_WARDROBE_GRANTS} from '../shared/content/wardrobe-catalog.ts';
import {cloneAppearance} from '../shared/content/appearance-catalog.ts';
import type {DistrictNetworkState} from '../src/game/types.ts';
import {CollisionMap} from '../server/world-map.ts';
import {vehicleConfig} from '../server/game/vehicles/vehicle-config.ts';
import {AMBIENT_TRAFFIC_TARGET} from '../server/game/population/district-population-controller.ts';
import {
  STREAMED_CIVILIAN_RECORDS,
  STREAMED_POLICE_RECORDS,
  STREAMED_TRAFFIC_RECORDS
} from '../server/game/population/population-streaming-controller.ts';
import {INTERIORS, STREET_SPACE_ID} from '../shared/content/interior-catalog.ts';

const hasLocalAssets = existsSync(resolve('public/assets/maps/district-map.json'));

test('two clients can use weapons, share cars, drive, fight, and respawn cleanly', {skip: !hasLocalAssets, timeout: 25_000}, async (context) => {
  const port = 28_000 + Math.floor(Math.random() * 1000);
  const server = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
    cwd: process.cwd(),
    env: {...process.env, GAME_PORT: String(port)},
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let serverOutput = '';
  server.stdout?.on('data', (chunk) => { serverOutput += chunk.toString(); });
  server.stderr?.on('data', (chunk) => { serverOutput += chunk.toString(); });
  context.after(() => stopServer(server));
  await waitForServer(port, server, () => serverOutput);

  const joinedAppearance = {...cloneAppearance(), outfitName: 'Night Run', topColor: 'red' as const};
  const first = await new Client(`ws://127.0.0.1:${port}`).joinOrCreate<DistrictNetworkState>('district', {
    name: 'Driver One',
    appearance: joinedAppearance
  });
  const second = await new Client(`ws://127.0.0.1:${port}`).joinOrCreate<DistrictNetworkState>('district', {name: 'Driver Two'});
  const debugSnapshots: DebugSnapshot[] = [];
  const appearanceResults: AppearanceResultMessage[] = [];
  const firstWardrobeStates: WardrobeStateMessage[] = [];
  const secondWardrobeStates: WardrobeStateMessage[] = [];
  first.onMessage<DebugSnapshot>(DEBUG_SNAPSHOT_MESSAGE, (snapshot) => debugSnapshots.push(snapshot));
  second.onMessage<DebugSnapshot>(DEBUG_SNAPSHOT_MESSAGE, () => undefined);
  first.onMessage<AppearanceResultMessage>(
    APPEARANCE_RESULT_MESSAGE,
    (result) => appearanceResults.push(result)
  );
  first.onMessage<WardrobeStateMessage>(
    WARDROBE_STATE_MESSAGE,
    (state) => firstWardrobeStates.push(state)
  );
  second.onMessage<WardrobeStateMessage>(
    WARDROBE_STATE_MESSAGE,
    (state) => secondWardrobeStates.push(state)
  );
  await delay(250);
  assert.equal(debugSnapshots.length, 0, 'Debug snapshots require an explicit client subscription.');
  first.send(DEBUG_SUBSCRIBE_MESSAGE);
  second.send(DEBUG_SUBSCRIBE_MESSAGE);
  first.onMessage(GAME_NOTICE_MESSAGE, () => undefined);
  second.onMessage(GAME_NOTICE_MESSAGE, () => undefined);
  context.after(async () => {
    await Promise.allSettled([first.leave(), second.leave()]);
  });

  await waitUntil(() => first.state.players.size === 2 && second.state.players.size === 2);
  await waitUntil(() => second.state.players.get(second.sessionId)?.armor === 25);
  await waitUntil(() => first.state.players.get(second.sessionId)?.armor === 25);
  await waitUntil(() => (
    first.state.services.size === 1 && first.state.npcs.size > 0 && first.state.vehicles.size > 0
  ));
  assert.ok(first.state.npcs.size < 13 + STREAMED_CIVILIAN_RECORDS + STREAMED_POLICE_RECORDS);
  assert.ok(first.state.vehicles.size < AMBIENT_TRAFFIC_TARGET + 3 + STREAMED_TRAFFIC_RECORDS);
  assert.equal(first.state.services.size, 1);
  assert.deepEqual([...first.state.services.values()].map((service) => service.kind), ['repair']);
  assert.equal(first.state.services.has('clothing-store'), false);
  assert.equal(first.state.services.has('hospital-mercy'), false);
  assert.ok([...first.state.vehicles.values()].every((vehicle) => {
    const maximumHealth = vehicleConfig(vehicle.kind).maxHealth;
    return vehicle.health === maximumHealth && vehicle.maxHealth === maximumHealth &&
      vehicle.engineDamage === 0;
  }));
  assert.equal(first.state.players.get(first.sessionId)?.name, 'Driver One');
  assert.equal(first.state.players.get(first.sessionId)?.armor, 25);
  assert.equal(first.state.players.get(second.sessionId)?.armor, 25);
  assert.equal(second.state.players.get(second.sessionId)?.armor, 25);
  assert.equal(second.state.players.get(first.sessionId)?.name, 'Driver One');
  assert.equal(first.state.players.get(first.sessionId)?.appearance.outfitName, 'Night Run');
  assert.equal(second.state.players.get(first.sessionId)?.appearance.topColor, 'red');

  first.send(WARDROBE_REQUEST_MESSAGE);
  await waitUntil(() => firstWardrobeStates.length === 1);
  await delay(60);
  assert.equal(secondWardrobeStates.length, 0, 'Wardrobe state must be private to its requester.');
  assert.deepEqual(firstWardrobeStates[0].ownedItemIds, DEVELOPMENT_WARDROBE_GRANTS);
  assert.equal(firstWardrobeStates[0].developmentGrants, true);
  const updatedAppearance = {...joinedAppearance, outfitName: 'Blue Shift', topColor: 'blue' as const};
  first.send(APPEARANCE_UPDATE_MESSAGE, updatedAppearance);
  await waitUntil(() => appearanceResults.length === 1);
  assert.equal(appearanceResults[0].status, 'applied');
  await waitUntil(() => second.state.players.get(first.sessionId)?.appearance.topColor === 'blue');
  assert.equal(first.state.players.get(first.sessionId)?.appearance.outfitName, 'Blue Shift');
  assert.equal(first.state.players.get(first.sessionId)?.weapon, 'pistol');
  await waitUntil(() => debugSnapshots.length > 0);
  const debugSnapshot = debugSnapshots.at(-1);
  assert.ok(debugSnapshot && debugSnapshot.tick > 0);
  assert.equal(
    debugSnapshot.spatialEntities,
    debugSnapshot.players + debugSnapshot.npcs + debugSnapshot.vehicles
  );
  assert.equal(debugSnapshot.deferredCommands, 0);

  first.send(MISSION_START_MESSAGE);
  await waitUntil(() => first.state.missions.size === 1 && second.state.missions.size === 1);
  const mission = [...first.state.missions.values()][0];
  assert.equal(mission.phase, 'forming');
  assert.equal(mission.leaderId, first.sessionId);
  assert.equal(mission.objectiveKind, 'acquire-vehicle');
  assert.equal(mission.objectiveCount, 3);
  assert.equal(mission.checkpointCount, 0);
  assert.ok(first.state.vehicles.has(mission.targetVehicleId));
  assert.equal(mission.participants.size, 1);
  second.send(MISSION_JOIN_MESSAGE, {missionId: mission.id});
  await waitUntil(() => first.state.missions.get(mission.id)?.participants.size === 2);
  assert.equal(second.state.missions.get(mission.id)?.participants.has(second.sessionId), true);
  first.send(MISSION_LAUNCH_MESSAGE, {missionId: mission.id});
  await waitUntil(() => first.state.missions.get(mission.id)?.phase === 'steal');
  assert.equal(second.state.missions.get(mission.id)?.phase, 'steal');
  assert.ok((first.state.missions.get(mission.id)?.remainingMs ?? 0) > 170_000);

  first.send('cycleWeapon', {direction: 1});
  await waitUntil(() => first.state.players.get(first.sessionId)?.weapon === 'smg');
  const smgAmmo = first.state.players.get(first.sessionId)?.ammoSmg;
  assert.equal(smgAmmo, 240);
  first.send('aim', {angle: Math.PI});
  first.send('shoot');
  await waitUntil(() => first.state.players.get(first.sessionId)?.ammoSmg === 239);
  first.send('cycleWeapon', {direction: 1});
  await waitUntil(() => first.state.players.get(first.sessionId)?.weapon === 'shotgun');
  first.send('cycleWeapon', {direction: 1});
  await waitUntil(() => first.state.players.get(first.sessionId)?.weapon === 'grenade');
  assert.equal(first.state.players.get(first.sessionId)?.ammoGrenade, 2);
  first.send('cycleWeapon', {direction: 1});
  await waitUntil(() => first.state.players.get(first.sessionId)?.weapon === 'fists');
  first.send('cycleWeapon', {direction: 1});
  await waitUntil(() => first.state.players.get(first.sessionId)?.weapon === 'bat');
  first.send('cycleWeapon', {direction: 1});
  await waitUntil(() => first.state.players.get(first.sessionId)?.weapon === 'pistol');

  const trafficStarts = new Map(
    [...first.state.vehicles.entries()]
      .filter(([, vehicle]) => vehicle.traffic)
      .map(([id, vehicle]) => [id, {x: vehicle.x, y: vehicle.y}])
  );
  assert.ok(
    trafficStarts.size > 0 && trafficStarts.size < AMBIENT_TRAFFIC_TARGET + STREAMED_TRAFFIC_RECORDS
  );
  await waitUntil(() => [...trafficStarts.entries()].some(([id, start]) => {
    const vehicle = first.state.vehicles.get(id);
    return Boolean(vehicle && Math.hypot(vehicle.x - start.x, vehicle.y - start.y) > 10);
  }), 4000);

  first.send('interact');
  await waitUntil(() => {
    const player = first.state.players.get(first.sessionId);
    return Boolean(player?.vehicleId) && player?.vehicleSeat === 0;
  });
  const vehicleId = first.state.players.get(first.sessionId)?.vehicleId;
  assert.ok(vehicleId);
  assert.equal(first.state.players.get(first.sessionId)?.vehicleSeat, 0);
  second.send('interact');
  await waitUntil(() => {
    const localPassenger = second.state.players.get(second.sessionId);
    const remotePassenger = first.state.players.get(second.sessionId);
    return localPassenger?.vehicleId === vehicleId && localPassenger.vehicleSeat === 1 &&
      remotePassenger?.vehicleId === vehicleId && remotePassenger.vehicleSeat === 1;
  });
  assert.equal(first.state.players.get(second.sessionId)?.vehicleSeat, 1);
  second.send('cycleWeapon', {direction: 1});
  await waitUntil(() => second.state.players.get(second.sessionId)?.weapon === 'smg');
  second.send('aim', {angle: 0.4});
  await waitUntil(() => Math.abs((second.state.players.get(second.sessionId)?.angle ?? 0) - 0.4) < 0.05);
  second.send('shoot');
  await waitUntil(() => second.state.players.get(second.sessionId)?.ammoSmg === 239);
  second.send('cycleWeapon', {direction: -1});
  await waitUntil(() => second.state.players.get(second.sessionId)?.weapon === 'pistol');
  second.send('interact');
  await waitUntil(() => !second.state.players.get(second.sessionId)?.vehicleId);
  const vehicleStart = first.state.vehicles.get(vehicleId);
  assert.ok(vehicleStart);
  const startVehiclePosition = {x: vehicleStart.x, y: vehicleStart.y};
  first.send('input', {x: 0, y: -1});
  await delay(650);
  first.send('input', {x: 0, y: 0});
  await waitUntil(() => {
    const vehicle = first.state.vehicles.get(vehicleId);
    return Boolean(vehicle && Math.hypot(vehicle.x - startVehiclePosition.x, vehicle.y - startVehiclePosition.y) > 12);
  });
  first.send('interact');
  await waitUntil(() => !first.state.players.get(first.sessionId)?.vehicleId);

  const playerBeforeMove = first.state.players.get(first.sessionId);
  assert.ok(playerBeforeMove);
  const startY = playerBeforeMove.y;
  first.send('input', {x: 0, y: 1});
  await delay(420);
  first.send('input', {x: 0, y: 0});
  await waitUntil(() => Math.abs((first.state.players.get(first.sessionId)?.y ?? startY) - startY) > 8);
  await waitUntil(() => Math.abs(
    (second.state.players.get(first.sessionId)?.y ?? startY) -
    (first.state.players.get(first.sessionId)?.y ?? startY)
  ) < 3);

  const world = CollisionMap.load();
  const attackDistance = await moveNear(
    first,
    first.sessionId,
    second.sessionId,
    44,
    (mover, target) => world.hasLineOfSight(mover.x, mover.y, target.x, target.y)
  );
  assert.ok(attackDistance <= 70, `First attacker stopped ${Math.round(attackDistance)} units away.`);
  const targetHealthBeforeMelee = first.state.players.get(second.sessionId)?.health ?? 100;
  const targetArmorBeforeMelee = first.state.players.get(second.sessionId)?.armor ?? 0;
  const targetReactionBeforeMelee = first.state.players.get(second.sessionId)?.reactionSequence ?? 0;
  const bulletsBeforeMelee = first.state.bullets.size;
  const ammoBeforeMelee = {
    pistol: first.state.players.get(first.sessionId)?.ammoPistol,
    smg: first.state.players.get(first.sessionId)?.ammoSmg,
    shotgun: first.state.players.get(first.sessionId)?.ammoShotgun,
    grenade: first.state.players.get(first.sessionId)?.ammoGrenade
  };
  first.send('cycleWeapon', {direction: -1});
  await waitUntil(() => first.state.players.get(first.sessionId)?.weapon === 'bat');
  const meleeAttacker = first.state.players.get(first.sessionId);
  const meleeTarget = first.state.players.get(second.sessionId);
  assert.ok(meleeAttacker && meleeTarget);
  first.send('aim', {angle: Math.atan2(
    meleeTarget.y - meleeAttacker.y,
    meleeTarget.x - meleeAttacker.x
  )});
  await delay(40);
  const sequenceBefore = meleeAttacker.attackSequence ?? 0;
  first.send('shoot');
  await waitUntil(() => (
    (first.state.players.get(first.sessionId)?.attackSequence ?? 0) > sequenceBefore &&
    (second.state.players.get(first.sessionId)?.attackSequence ?? 0) > sequenceBefore
  ));
  assert.equal(second.state.players.get(first.sessionId)?.action, 'melee');
  await waitUntil(() => (
    (first.state.players.get(second.sessionId)?.reactionSequence ?? 0) >
      targetReactionBeforeMelee &&
    (second.state.players.get(second.sessionId)?.reactionSequence ?? 0) >
      targetReactionBeforeMelee
  ));
  const meleeDamageToHealth = Math.max(0, 34 - targetArmorBeforeMelee);
  assert.equal(first.state.players.get(second.sessionId)?.armor, 0);
  assert.equal(first.state.players.get(second.sessionId)?.health, targetHealthBeforeMelee - meleeDamageToHealth);
  assert.equal(first.state.players.get(second.sessionId)?.reactionKind, 'knockdown');
  assert.equal(second.state.players.get(second.sessionId)?.reactionKind, 'knockdown');
  assert.equal(first.state.players.get(second.sessionId)?.action, 'knockdown');
  assert.equal(first.state.bullets.size, bulletsBeforeMelee);
  assert.deepEqual(
    {
      pistol: first.state.players.get(first.sessionId)?.ammoPistol,
      smg: first.state.players.get(first.sessionId)?.ammoSmg,
      shotgun: first.state.players.get(first.sessionId)?.ammoShotgun,
      grenade: first.state.players.get(first.sessionId)?.ammoGrenade
    },
    ammoBeforeMelee
  );
  await waitUntil(() => first.state.players.get(first.sessionId)?.action === '');
  first.send('cycleWeapon', {direction: 1});
  await waitUntil(() => first.state.players.get(first.sessionId)?.weapon === 'pistol');
  for (let shot = 0; shot < 8 && first.state.players.get(second.sessionId)?.alive; shot++) {
    const shooter = first.state.players.get(first.sessionId);
    const target = first.state.players.get(second.sessionId);
    assert.ok(shooter && target);
    first.send('aim', {angle: Math.atan2(target.y - shooter.y, target.x - shooter.x)});
    await delay(25);
    first.send('shoot');
    await delay(220);
  }
  await waitUntil(() => first.state.players.get(second.sessionId)?.alive === false);
  assert.ok((first.state.players.get(first.sessionId)?.wanted ?? 0) >= 1);
  await waitUntil(() => debugSnapshots.some((snapshot) => snapshot.pursuits.length > 0));
  assert.ok(debugSnapshots.some((snapshot) => (
    snapshot.events.some((event) => event.type === 'incident.reported')
  )));
  assert.ok((first.state.players.get(first.sessionId)?.cash ?? 0) >= 100);
  await waitUntil(() => second.state.players.get(second.sessionId)?.alive === true, 5000);
  assert.equal(second.state.players.get(second.sessionId)?.health, 100);
  assert.equal(second.state.players.get(second.sessionId)?.armor, 0);
  await returnToStreetIfNeeded(second, second.sessionId);

  const hospital = INTERIORS[0];
  await driveToSpace(
    second,
    hospital.exteriorDoor.x,
    hospital.exteriorDoor.y,
    hospital.id
  );
  await waitUntil(() => (
    second.state.players.get(second.sessionId)?.spaceId === hospital.id &&
    second.state.npcs.size === 0 &&
    second.state.vehicles.size === 0 &&
    second.state.missions.size === 0 &&
    second.state.services.size === 1 &&
    second.state.services.has('hospital-mercy')
  ));
  await driveToSpace(
    second,
    hospital.exitDoor.maxX,
    (hospital.exitDoor.minY + hospital.exitDoor.maxY) / 2,
    STREET_SPACE_ID
  );
  await waitUntil(() => (
    second.state.npcs.size > 0 &&
    second.state.vehicles.size > 0 &&
    second.state.services.size === 1 &&
    second.state.services.has('repair-garage') &&
    !second.state.services.has('hospital-mercy')
  ));
});

async function returnToStreetIfNeeded(
  room: Room<DistrictNetworkState>,
  playerId: string
): Promise<void> {
  const spaceId = room.state.players.get(playerId)?.spaceId || STREET_SPACE_ID;
  if (spaceId === STREET_SPACE_ID) return;
  const interior = INTERIORS.find((candidate) => candidate.id === spaceId);
  assert.ok(interior, `Unknown respawn interior: ${spaceId}`);
  await driveToSpace(
    room,
    interior.exitDoor.maxX,
    (interior.exitDoor.minY + interior.exitDoor.maxY) / 2,
    STREET_SPACE_ID
  );
}

async function waitForServer(port: number, child: ChildProcess, output: () => string): Promise<void> {
  await waitUntil(async () => {
    if (child.exitCode !== null) throw new Error(`Game server stopped early.\n${output()}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      return response.ok;
    } catch {
      return false;
    }
  }, 5000);
}

async function waitUntil(check: () => boolean | Promise<boolean>, timeout = 3000): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await delay(30);
  }
  throw new Error('Timed out waiting for multiplayer state.');
}

async function moveNear(
  room: Room<DistrictNetworkState>,
  moverId: string,
  targetId: string,
  targetDistance: number,
  positionIsUsable: (
    mover: {x: number; y: number},
    target: {x: number; y: number}
  ) => boolean = () => true
): Promise<number> {
  let previousDistance = Number.POSITIVE_INFINITY;
  let stagnantSteps = 0;
  let detourSteps = 0;
  let detourDirection = 1;
  for (let step = 0; step < 60; step++) {
    const mover = room.state.players.get(moverId);
    const target = room.state.players.get(targetId);
    if (!mover || !target) {
      await delay(30);
      continue;
    }
    const deltaX = target.x - mover.x;
    const deltaY = target.y - mover.y;
    const distance = Math.hypot(deltaX, deltaY);
    if (distance <= targetDistance && positionIsUsable(mover, target)) break;
    if (distance >= previousDistance - 1) stagnantSteps++;
    else stagnantSteps = 0;
    if (stagnantSteps >= 4) {
      detourSteps = 6;
      detourDirection *= -1;
      stagnantSteps = 0;
    }
    const input = detourSteps > 0
      ? {x: -deltaY / distance * detourDirection, y: deltaX / distance * detourDirection}
      : {x: deltaX / distance, y: deltaY / distance};
    if (detourSteps > 0) detourSteps--;
    room.send('input', input);
    previousDistance = distance;
    await delay(100);
  }
  room.send('input', {x: 0, y: 0});
  const mover = room.state.players.get(moverId);
  const target = room.state.players.get(targetId);
  return mover && target ? Math.hypot(target.x - mover.x, target.y - mover.y) : Number.POSITIVE_INFINITY;
}

async function driveToSpace(
  room: Room<DistrictNetworkState>,
  x: number,
  y: number,
  spaceId: string
): Promise<void> {
  for (let step = 0; step < 180; step++) {
    const player = room.state.players.get(room.sessionId);
    assert.ok(player, 'Local player must remain replicated during a space transition.');
    if ((player.spaceId || STREET_SPACE_ID) === spaceId) {
      room.send('input', {x: 0, y: 0});
      return;
    }
    const deltaX = x - player.x;
    const deltaY = y - player.y;
    const distance = Math.max(1, Math.hypot(deltaX, deltaY));
    room.send('input', {x: deltaX / distance, y: deltaY / distance});
    await delay(40);
  }
  room.send('input', {x: 0, y: 0});
  throw new Error(`Timed out driving client into space: ${spaceId}`);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

function stopServer(server: ChildProcess): void {
  if (server.exitCode === null) server.kill('SIGTERM');
}
