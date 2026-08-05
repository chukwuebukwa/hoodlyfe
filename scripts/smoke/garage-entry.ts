import {Client, type Room} from 'colyseus.js';
import {ON_FOOT_INPUT_MESSAGE} from '../../shared/protocol/on-foot-input.ts';
import {
  compileSeamlessInteriorCatalog,
  type SeamlessGarageDoorDefinition
} from '../../shared/content/seamless-interior-catalog.ts';
import {parseBuildingManifest} from '../../shared/content/building-manifest.ts';
import type {DistrictNetworkState} from '../../src/game/types.ts';
import {CollisionMap} from '../../server/world-map.ts';

const endpoint = process.env.GAME_SERVER_URL ?? 'wss://hoodlyfe.up.railway.app';
const roomName = process.env.GAME_ROOM ?? 'district';
const garageId = process.env.GARAGE_ID ?? 'westside-auto-garage';
const timeoutMs = Number(process.env.GARAGE_SMOKE_TIMEOUT_MS ?? 45_000);
const playerRadius = 11;

const client = new Client(endpoint);
let room: Room<DistrictNetworkState> | undefined;

try {
  room = await client.joinOrCreate<DistrictNetworkState>(roomName, {
    name: `Garage Smoke ${Date.now() % 10_000}`
  });
  room.onMessage('police.awareness', () => undefined);
  room.onMessage('game.notice', () => undefined);
  room.onMessage('audio.events', () => undefined);
  const player = await waitFor(() => room?.state.players?.get(room.sessionId), timeoutMs);
  const door = await loadGarageDoor(room, garageId);
  const world = CollisionMap.load();
  const outward = entranceOutwardVector(door.side);
  const outside = {
    x: door.x + outward.x * Math.min(door.openRadius * 0.6, 96),
    y: door.y + outward.y * Math.min(door.openRadius * 0.6, 96)
  };
  const inside = {
    x: door.x - outward.x * 96,
    y: door.y - outward.y * 96
  };
  const route = findRoute(world, player.x, player.y, outside.x, outside.y, player.surfaceId);
  const nearbyVehicle = [...(room.state.vehicles?.values() ?? [])].find((vehicle) => (
    Math.hypot(vehicle.x - player.x, vehicle.y - player.y) < 100
  ));
  if (nearbyVehicle) route.splice(1, 1, {x: player.x, y: player.y - 96});

  console.log(JSON.stringify({
    kind: 'garage-smoke-start',
    endpoint,
    roomId: room.roomId,
    contentRevision: room.state.contentRevision,
    garageId,
    player: pose(player),
    outside,
    inside,
    routePoints: route.length,
    route
  }));

  let sequence = 0;
  await follow(room, route, () => ++sequence, timeoutMs);
  const opening = await waitFor(() => {
    const state = room?.state.garageDoors?.get(garageId);
    return state && state.progress >= 0.78 ? state : undefined;
  }, 5_000);
  console.log(JSON.stringify({
    kind: 'garage-smoke-door',
    garageId,
    phase: opening.phase,
    progress: opening.progress,
    player: pose(player)
  }));

  await follow(room, [inside], () => ++sequence, 8_000);
  const crossed = crossedThreshold(player.x, player.y, door, 24);
  console.log(JSON.stringify({
    kind: 'garage-smoke-result',
    garageId,
    crossed,
    door: room.state.garageDoors?.get(garageId),
    player: pose(player)
  }));
  if (!crossed) process.exitCode = 1;
} finally {
  await room?.leave(true).catch(() => undefined);
}

async function loadGarageDoor(
  joined: Room<DistrictNetworkState>,
  id: string
): Promise<SeamlessGarageDoorDefinition> {
  const assetRoot = joined.state.contentAssetRoot;
  const buildingsPath = joined.state.contentBuildingsPath;
  if (!assetRoot || !buildingsPath) {
    const local = CollisionMap.load().seamlessInteriors.garageDoor(id);
    if (!local) throw new Error(`Unknown local garage ${id}.`);
    return local;
  }
  const response = await fetch(`${endpoint.replace(/^ws/, 'http')}${assetRoot}/${buildingsPath}`);
  if (!response.ok) throw new Error(`Building manifest returned HTTP ${response.status}.`);
  const catalog = compileSeamlessInteriorCatalog(
    parseBuildingManifest(await response.json(), buildingsPath)
  );
  const door = catalog.garageDoor(id);
  if (!door) throw new Error(`Production content does not contain garage ${id}.`);
  return door;
}

async function follow(
  joined: Room<DistrictNetworkState>,
  route: readonly {x: number; y: number}[],
  nextSequence: () => number,
  limitMs: number
): Promise<void> {
  const startedAt = Date.now();
  for (const target of route) {
    while (Date.now() - startedAt < limitMs) {
      const player = joined.state.players?.get(joined.sessionId);
      if (!player) throw new Error('Production player disappeared during garage smoke test.');
      const dx = target.x - player.x;
      const dy = target.y - player.y;
      const distance = Math.hypot(dx, dy);
      if (distance <= 18) break;
      joined.send(ON_FOOT_INPUT_MESSAGE, {
        moves: [{sequence: nextSequence(), x: dx / distance, y: dy / distance}]
      });
      await delay(50);
    }
    const player = joined.state.players?.get(joined.sessionId);
    if (!player || Math.hypot(target.x - player.x, target.y - player.y) > 28) {
      throw new Error(`Timed out walking production route near ${JSON.stringify(pose(player))}.`);
    }
  }
}

function findRoute(
  world: CollisionMap,
  startX: number,
  startY: number,
  targetX: number,
  targetY: number,
  surfaceId: string
): Array<{x: number; y: number}> {
  const step = 32;
  const start = snap(startX, startY, step);
  const target = snap(targetX, targetY, step);
  const queue = [start];
  const previous = new Map<string, {x: number; y: number} | undefined>([[key(start), undefined]]);
  const directions = [
    {x: 1, y: 0}, {x: -1, y: 0}, {x: 0, y: 1}, {x: 0, y: -1},
    {x: 1, y: 1}, {x: 1, y: -1}, {x: -1, y: 1}, {x: -1, y: -1}
  ];
  for (let index = 0; index < queue.length && index < 20_000; index++) {
    const current = queue[index];
    if (Math.hypot(current.x - target.x, current.y - target.y) <= step) {
      const route: Array<{x: number; y: number}> = [{x: targetX, y: targetY}];
      let cursor: {x: number; y: number} | undefined = current;
      while (cursor) {
        route.unshift(cursor);
        cursor = previous.get(key(cursor));
      }
      return simplify(route);
    }
    for (const direction of directions) {
      const candidate = {
        x: current.x + direction.x * step,
        y: current.y + direction.y * step
      };
      if (previous.has(key(candidate))) continue;
      if (Math.hypot(candidate.x - start.x, candidate.y - start.y) > 3_000) continue;
      if (!world.canOccupy(candidate.x, candidate.y, playerRadius, surfaceId, 'player')) continue;
      previous.set(key(candidate), current);
      queue.push(candidate);
    }
  }
  throw new Error(`No local route to production garage ${garageId}.`);
}

function simplify(route: readonly {x: number; y: number}[]): Array<{x: number; y: number}> {
  return route.filter((point, index) => {
    if (index === 0 || index === route.length - 1) return true;
    const previous = route[index - 1];
    const next = route[index + 1];
    return Math.sign(point.x - previous.x) !== Math.sign(next.x - point.x) ||
      Math.sign(point.y - previous.y) !== Math.sign(next.y - point.y);
  });
}

function crossedThreshold(
  x: number,
  y: number,
  door: SeamlessGarageDoorDefinition,
  margin: number
): boolean {
  if (door.side === 'west') return x >= door.x + margin;
  if (door.side === 'east') return x <= door.x - margin;
  if (door.side === 'north') return y >= door.y + margin;
  return y <= door.y - margin;
}

function entranceOutwardVector(side: SeamlessGarageDoorDefinition['side']): {x: number; y: number} {
  if (side === 'north') return {x: 0, y: -1};
  if (side === 'east') return {x: 1, y: 0};
  if (side === 'south') return {x: 0, y: 1};
  return {x: -1, y: 0};
}

function snap(x: number, y: number, step: number): {x: number; y: number} {
  return {x: Math.round(x / step) * step, y: Math.round(y / step) * step};
}

function key(point: {x: number; y: number}): string {
  return `${point.x}:${point.y}`;
}

function pose(value: {x: number; y: number; surfaceId?: string} | undefined) {
  return value && {x: Math.round(value.x), y: Math.round(value.y), surfaceId: value.surfaceId};
}

async function waitFor<T>(read: () => T | undefined, limitMs: number): Promise<T> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < limitMs) {
    const value = read();
    if (value !== undefined) return value;
    await delay(25);
  }
  throw new Error(`Timed out after ${limitMs} ms.`);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
