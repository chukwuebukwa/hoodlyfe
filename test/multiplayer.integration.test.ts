import assert from 'node:assert/strict';
import {spawn, type ChildProcess} from 'node:child_process';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import test from 'node:test';
import {Client, type Room} from 'colyseus.js';
import type {DistrictNetworkState} from '../src/game/types.ts';

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
  context.after(async () => {
    await Promise.allSettled([first.leave(), second.leave()]);
  });

  await waitUntil(() => first.state.players.size === 2 && second.state.players.size === 2);
  assert.equal(first.state.npcs.size, 13);
  assert.equal(first.state.vehicles.size, 11);
  assert.equal(first.state.players.get(first.sessionId)?.name, 'Driver One');
  assert.equal(second.state.players.get(first.sessionId)?.name, 'Driver One');
  assert.equal(first.state.players.get(first.sessionId)?.weapon, 'pistol');

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
  await waitUntil(() => Boolean(first.state.players.get(first.sessionId)?.vehicleId));
  const vehicleId = first.state.players.get(first.sessionId)?.vehicleId;
  assert.ok(vehicleId);
  assert.equal(first.state.players.get(first.sessionId)?.vehicleSeat, 0);
  second.send('interact');
  await waitUntil(() => second.state.players.get(second.sessionId)?.vehicleId === vehicleId);
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
  assert.ok((first.state.players.get(first.sessionId)?.cash ?? 0) >= 100);
  await waitUntil(() => first.state.players.get(second.sessionId)?.alive === true, 5000);
  assert.equal(first.state.players.get(second.sessionId)?.health, 100);

  const revengeShooter = second.state.players.get(second.sessionId);
  const wantedTarget = second.state.players.get(first.sessionId);
  assert.ok(revengeShooter && wantedTarget);
  second.send('aim', {angle: Math.atan2(wantedTarget.y - revengeShooter.y, wantedTarget.x - revengeShooter.x)});
  await delay(80);
  for (let shot = 0; shot < 6 && second.state.players.get(first.sessionId)?.alive; shot++) {
    second.send('shoot');
    await delay(220);
  }
  await waitUntil(() => second.state.players.get(first.sessionId)?.alive === false, 5000);
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

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

function stopServer(server: ChildProcess): void {
  if (server.exitCode === null) server.kill('SIGTERM');
}
