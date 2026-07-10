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
  MISSION_NOTICE_MESSAGE,
  MISSION_START_MESSAGE
} from '../shared/protocol/missions.ts';
import type {DistrictNetworkState} from '../src/game/types.ts';
import {CollisionMap} from '../server/world-map.ts';

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

  const first = await new Client(`ws://127.0.0.1:${port}`).joinOrCreate<DistrictNetworkState>('district', {name: 'Driver One'});
  const second = await new Client(`ws://127.0.0.1:${port}`).joinOrCreate<DistrictNetworkState>('district', {name: 'Driver Two'});
  const debugSnapshots: DebugSnapshot[] = [];
  first.onMessage<DebugSnapshot>(DEBUG_SNAPSHOT_MESSAGE, (snapshot) => debugSnapshots.push(snapshot));
  second.onMessage<DebugSnapshot>(DEBUG_SNAPSHOT_MESSAGE, () => undefined);
  await delay(250);
  assert.equal(debugSnapshots.length, 0, 'Debug snapshots require an explicit client subscription.');
  first.send(DEBUG_SUBSCRIBE_MESSAGE);
  second.send(DEBUG_SUBSCRIBE_MESSAGE);
  first.onMessage(MISSION_NOTICE_MESSAGE, () => undefined);
  second.onMessage(MISSION_NOTICE_MESSAGE, () => undefined);
  context.after(async () => {
    await Promise.allSettled([first.leave(), second.leave()]);
  });

  await waitUntil(() => first.state.players.size === 2 && second.state.players.size === 2);
  assert.equal(first.state.npcs.size, 13);
  assert.equal(first.state.vehicles.size, 11);
  assert.ok([...first.state.vehicles.values()].every((vehicle) => (
    vehicle.health === 1000 && vehicle.maxHealth === 1000 && vehicle.engineDamage === 0
  )));
  assert.equal(first.state.players.get(first.sessionId)?.name, 'Driver One');
  assert.equal(second.state.players.get(first.sessionId)?.name, 'Driver One');
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
  await waitUntil(() => first.state.players.get(first.sessionId)?.weapon === 'pistol');

  const trafficStarts = new Map(
    [...first.state.vehicles.entries()]
      .filter(([, vehicle]) => vehicle.traffic)
      .map(([id, vehicle]) => [id, {x: vehicle.x, y: vehicle.y}])
  );
  assert.equal(trafficStarts.size, 8);
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

  const shooter = first.state.players.get(first.sessionId);
  const target = first.state.players.get(second.sessionId);
  assert.ok(shooter && target);
  first.send('aim', {angle: Math.atan2(target.y - shooter.y, target.x - shooter.x)});
  await delay(80);
  for (let shot = 0; shot < 4; shot++) {
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
  await waitUntil(() => first.state.players.get(second.sessionId)?.alive === true, 5000);
  assert.equal(first.state.players.get(second.sessionId)?.health, 100);

  const revengeShooter = second.state.players.get(second.sessionId);
  const wantedTarget = second.state.players.get(first.sessionId);
  assert.ok(revengeShooter && wantedTarget);
  const world = CollisionMap.load();
  const revengeDistance = await moveNear(
    second,
    second.sessionId,
    first.sessionId,
    110,
    (mover, target) => world.hasLineOfSight(mover.x, mover.y, target.x, target.y)
  );
  assert.ok(revengeDistance <= 150, `Revenge shooter stopped ${Math.round(revengeDistance)} units away.`);
  const revengePosition = second.state.players.get(second.sessionId);
  const targetPosition = second.state.players.get(first.sessionId);
  assert.ok(revengePosition && targetPosition);
  assert.equal(
    world.hasLineOfSight(revengePosition.x, revengePosition.y, targetPosition.x, targetPosition.y),
    true,
    'Revenge shooter requires a collision-free firing lane.'
  );
  for (let shot = 0; shot < 16 && second.state.players.get(first.sessionId)?.alive; shot++) {
    const currentShooter = second.state.players.get(second.sessionId);
    const currentTarget = second.state.players.get(first.sessionId);
    assert.ok(currentShooter && currentTarget);
    second.send('aim', {
      angle: Math.atan2(currentTarget.y - currentShooter.y, currentTarget.x - currentShooter.x)
    });
    await delay(25);
    second.send('shoot');
    await delay(220);
  }
  await waitUntil(() => second.state.players.get(first.sessionId)?.alive === false, 5000).catch(() => {
    const shooter = second.state.players.get(second.sessionId);
    const target = second.state.players.get(first.sessionId);
    const distance = shooter && target ? Math.hypot(target.x - shooter.x, target.y - shooter.y) : -1;
    throw new Error(
      `Revenge fire did not kill target: health=${target?.health}, distance=${Math.round(distance)}.`
    );
  });
  await waitUntil(() => second.state.players.get(first.sessionId)?.alive === true, 5000);
  assert.equal(second.state.players.get(first.sessionId)?.wanted, 0);
});

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
    if (!mover || !target) break;
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

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

function stopServer(server: ChildProcess): void {
  if (server.exitCode === null) server.kill('SIGTERM');
}
