import {cli, type Options} from '@colyseus/loadtest';
import {Client, type Room} from 'colyseus.js';
import {readFileSync} from 'node:fs';
import {ON_FOOT_INPUT_MESSAGE} from '../../shared/protocol/on-foot-input.ts';
import {VOICE_PEERS_MESSAGE} from '../../shared/protocol/proximity-voice.ts';
import {VEHICLE_INPUT_MESSAGE} from '../../shared/protocol/vehicle-input.ts';
import type {DistrictNetworkState} from '../../src/game/types.ts';
import {
  MapRoutePlanner,
  type MapRouteDocument,
  type MapRoutePoint
} from './map-route-planner.ts';

const DURATION_MS = Number(process.env.LOADTEST_DURATION_MS ?? 10 * 60_000);
const RECONNECT_INTERVAL_MS = Number(process.env.LOADTEST_RECONNECT_INTERVAL_MS ?? 2 * 60_000);
const MAP_TRAVERSAL = process.env.LOADTEST_MAP_TRAVERSAL === '1';
const MINIMUM_MAP_COVERAGE = Number(process.env.LOADTEST_MIN_MAP_COVERAGE ?? 0.65);
const INPUT_INTERVAL_MS = 50;
const INTERACTION_INTERVAL_MS = Number(process.env.LOADTEST_INTERACTION_INTERVAL_MS ?? (
  MAP_TRAVERSAL ? 3_000 : 15_000
));
const HEALTH_INTERVAL_MS = 5_000;
const RSS_WARMUP_MS = 2 * 60_000;
const MAP_STUCK_MS = 6_000;
const MAP_RECOVERY_MS = 1_500;
const SUSTAINED_THRESHOLD_SAMPLES = 5 * 60_000 / HEALTH_INTERVAL_MS;
let durationTimerArmed = false;
let decoderErrors = 0;
let roomErrors = 0;
let reconnectErrors = 0;
let unhealthySamples = 0;
let maximumRssMb = 0;
let maximumPhysicsP95Ms = 0;
let maximumEventLoopP99Ms = 0;
let successfulReconnects = 0;
let unexpectedDisconnects = 0;
let interactionMessages = 0;
let vehicleEntries = 0;
let vehicleExits = 0;
let highPhysicsSamples = 0;
let highEventLoopSamples = 0;
let highRssSamples = 0;
const sustainedThresholdBreaches = new Set<string>();
const rssSamples: Array<{elapsedMs: number; rssMb: number}> = [];
const mapPlanner = MAP_TRAVERSAL ? loadMapPlanner() : undefined;
const visitedMapSectors = new Set<string>();
const mapTargetRounds = new Map<number, number>();
let mapDistancePx = 0;
let mapWaypointsReached = 0;
let mapTargetsReached = 0;
let mapRecoveries = 0;
const mapClientProgress = new Map<number, {
  x: number;
  y: number;
  sector?: string;
  vehicle: boolean;
  targetAnchor: number;
  routeIndex: number;
  routeLength: number;
}>();
let healthSamplingStartedAt = 0;
let ending = false;
const activeRooms = new Set<Room<DistrictNetworkState>>();
const plannedLeaves = new Set<Room<DistrictNetworkState>>();

const originalConsoleError = console.error.bind(console);
console.error = (...args: unknown[]) => {
  if (args.some((argument) => String(argument).includes('refId') && String(argument).includes('not found'))) {
    decoderErrors++;
  }
  originalConsoleError(...args);
};

cli(async (options) => {
  armDurationTimer(options);
  await connectBot(options);
});

async function connectBot(options: Options, reconnect = false): Promise<void> {
  const client = new Client(options.endpoint);
  const room = options.roomId
    ? await client.joinById<DistrictNetworkState>(options.roomId, joinOptions(options.clientId))
    : await client.joinOrCreate<DistrictNetworkState>(options.roomName, joinOptions(options.clientId));
  activeRooms.add(room);
  if (reconnect) successfulReconnects++;
  driveClient(room, options);
}

function driveClient(room: Room<DistrictNetworkState>, options: Options): void {
  const {clientId} = options;
  let sequence = 0;
  let previousVehicleId = '';
  let previousMapPose: MapRoutePoint | undefined;
  let route: MapRoutePoint[] = [];
  let routeIndex = 0;
  let targetAnchor = -1;
  let progressPose: MapRoutePoint | undefined;
  let lastProgressAt = Date.now();
  let recoveryUntil = 0;
  const startedAt = Date.now();
  const inputTimer = setInterval(() => {
    const elapsed = Date.now() - startedAt;
    const phase = elapsed / 3_000 + clientId * 0.73;
    if (!room.state.players || !room.state.vehicles) return;
    const player = room.state.players.get(room.sessionId);
    const vehicleId = player?.vehicleId ?? '';
    const vehicle = vehicleId ? room.state.vehicles.get(vehicleId) : undefined;
    const mapPose = vehicle ?? player;
    if (mapPlanner && mapPose) {
      const sector = mapPlanner.sectorAt(mapPose.x, mapPose.y);
      if (sector) visitedMapSectors.add(sector);
      if (previousMapPose) {
        const distance = Math.hypot(mapPose.x - previousMapPose.x, mapPose.y - previousMapPose.y);
        if (distance < 1_000) mapDistancePx += distance;
      }
      previousMapPose = {x: mapPose.x, y: mapPose.y};
    }
    const target = !vehicleId && player ? nearestVehicle(room, player.x, player.y) : undefined;
    const distance = target && player ? Math.hypot(target.x - player.x, target.y - player.y) : 0;
    let x = target && player && distance > 1 ? (target.x - player.x) / distance : Math.cos(phase);
    let y = target && player && distance > 1 ? (target.y - player.y) / distance : Math.sin(phase * 0.83);
    if (mapPlanner && vehicle) {
      if (routeIndex >= route.length) {
        if (route.length > 0) mapTargetsReached++;
        const round = mapTargetRounds.get(clientId) ?? 0;
        targetAnchor = clientId + round * options.numClients;
        mapTargetRounds.set(clientId, round + 1);
        route = mapPlanner.routeToAnchor(vehicle.x, vehicle.y, targetAnchor);
        routeIndex = 0;
        progressPose = {x: vehicle.x, y: vehicle.y};
        lastProgressAt = Date.now();
      }
      while (routeIndex < route.length && Math.hypot(
        route[routeIndex].x - vehicle.x,
        route[routeIndex].y - vehicle.y
      ) <= 96) {
        routeIndex++;
        mapWaypointsReached++;
      }
      const waypoint = route[routeIndex];
      if (waypoint) {
        const targetAngle = Math.atan2(waypoint.y - vehicle.y, waypoint.x - vehicle.x);
        const angleError = normalizeAngle(targetAngle - vehicle.angle);
        x = Math.max(-1, Math.min(1, angleError * 1.6));
        y = Math.abs(angleError) > 2.5 ? -0.25 : -1;
      }
      if (!progressPose || Math.hypot(vehicle.x - progressPose.x, vehicle.y - progressPose.y) >= 96) {
        progressPose = {x: vehicle.x, y: vehicle.y};
        lastProgressAt = Date.now();
      } else if (Date.now() - lastProgressAt >= MAP_STUCK_MS) {
        recoveryUntil = Date.now() + MAP_RECOVERY_MS;
        route = mapPlanner.routeToAnchor(vehicle.x, vehicle.y, targetAnchor);
        routeIndex = 0;
        progressPose = {x: vehicle.x, y: vehicle.y};
        lastProgressAt = Date.now();
        mapRecoveries++;
      }
      if (Date.now() < recoveryUntil) {
        x = clientId % 2 === 0 ? 1 : -1;
        y = 1;
      }
      mapClientProgress.set(clientId, {
        x: Math.round(vehicle.x),
        y: Math.round(vehicle.y),
        sector: mapPlanner.sectorAt(vehicle.x, vehicle.y),
        vehicle: true,
        targetAnchor,
        routeIndex,
        routeLength: route.length
      });
    } else if (mapPlanner && player) {
      mapClientProgress.set(clientId, {
        x: Math.round(player.x),
        y: Math.round(player.y),
        sector: mapPlanner.sectorAt(player.x, player.y),
        vehicle: false,
        targetAnchor,
        routeIndex,
        routeLength: route.length
      });
    }
    if (!previousVehicleId && vehicleId) vehicleEntries++;
    if (previousVehicleId && !vehicleId) vehicleExits++;
    previousVehicleId = vehicleId;
    if (vehicleId && player?.vehicleSeat === 0) {
      room.send(VEHICLE_INPUT_MESSAGE, {vehicleId, moves: [{sequence: ++sequence, x, y}]});
    } else {
      room.send(ON_FOOT_INPUT_MESSAGE, {moves: [{sequence: ++sequence, x, y}]});
    }
  }, INPUT_INTERVAL_MS);
  const interactionTimer = setInterval(() => {
    if (!room.state.players) return;
    const player = room.state.players.get(room.sessionId);
    if (MAP_TRAVERSAL && player?.vehicleId) return;
    interactionMessages++;
    room.send('interact');
  }, INTERACTION_INTERVAL_MS);
  room.onMessage('game.notice', () => undefined);
  room.onMessage('audio.events', () => undefined);
  room.onMessage(VOICE_PEERS_MESSAGE, () => undefined);
  room.onError((code, message) => {
    roomErrors++;
    console.error(`[loadtest:${clientId}] room error ${code}: ${message}`);
  });
  room.onLeave(() => {
    if (!plannedLeaves.delete(room) && !ending) unexpectedDisconnects++;
    activeRooms.delete(room);
    clearInterval(inputTimer);
    clearInterval(interactionTimer);
  });
  setTimeout(async () => {
    if (ending) return;
    try {
      plannedLeaves.add(room);
      await room.leave(true);
      await connectBot(options, true);
    } catch (error) {
      reconnectErrors++;
      console.error(`[loadtest:${clientId}] reconnect failed`, error);
    }
  }, RECONNECT_INTERVAL_MS + clientId * 25);
}

function armDurationTimer(options: Options): void {
  if (durationTimerArmed || options.clientId !== 0) return;
  durationTimerArmed = true;
  healthSamplingStartedAt = Date.now();
  const healthTimer = setInterval(() => {
    void sampleHealth(options.endpoint);
  }, HEALTH_INTERVAL_MS);
  setTimeout(async () => {
    ending = true;
    clearInterval(healthTimer);
    await sampleHealth(options.endpoint);
    for (const room of activeRooms) plannedLeaves.add(room);
    await Promise.allSettled([...activeRooms].map((room) => room.leave(true)));
    const reconnectGate = DURATION_MS <= RECONNECT_INTERVAL_MS ||
      successfulReconnects >= options.numClients;
    const vehicleLifecycleGate = DURATION_MS < 60_000 || vehicleEntries > 0 && (
      MAP_TRAVERSAL || vehicleExits > 0
    );
    const mapCoveragePercent = mapPlanner
      ? visitedMapSectors.size / mapPlanner.coverageSectorCount
      : 1;
    const mapCoverageGate = !mapPlanner || mapCoveragePercent >= MINIMUM_MAP_COVERAGE;
    const passed = decoderErrors === 0 && roomErrors === 0 && reconnectErrors === 0 &&
      unexpectedDisconnects === 0 && unhealthySamples === 0 && reconnectGate &&
      vehicleLifecycleGate && mapCoverageGate && sustainedThresholdBreaches.size === 0;
    console.log(JSON.stringify({
      kind: 'loadtest-summary',
      durationMs: DURATION_MS,
      decoderErrors,
      roomErrors,
      reconnectErrors,
      successfulReconnects,
      unexpectedDisconnects,
      interactionMessages,
      vehicleEntries,
      vehicleExits,
      reconnectGate,
      vehicleLifecycleGate,
      mapTraversal: MAP_TRAVERSAL,
      mapCoverageVisitedSectors: visitedMapSectors.size,
      mapCoverageTotalSectors: mapPlanner?.coverageSectorCount ?? 0,
      mapCoveragePercent: Math.round(mapCoveragePercent * 10_000) / 100,
      mapMinimumCoveragePercent: Math.round(MINIMUM_MAP_COVERAGE * 10_000) / 100,
      mapCoverageGate,
      mapDistancePx: Math.round(mapDistancePx),
      mapWaypointsReached,
      mapTargetsReached,
      mapRecoveries,
      mapClientProgress: [...mapClientProgress]
        .sort(([left], [right]) => left - right)
        .map(([clientId, progress]) => ({clientId, ...progress})),
      unhealthySamples,
      maximumRssMb,
      maximumPhysicsP95Ms,
      maximumEventLoopP99Ms,
      sustainedThresholdBreaches: [...sustainedThresholdBreaches],
      postTwoMinuteRssGrowthMb: postWarmupRssGrowth(),
      passed
    }));
    process.exit(passed ? 0 : 1);
  }, DURATION_MS);
}

function nearestVehicle(
  room: Room<DistrictNetworkState>,
  x: number,
  y: number
): {x: number; y: number} | undefined {
  if (!room.state.vehicles) return undefined;
  let nearest: {x: number; y: number} | undefined;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const vehicle of room.state.vehicles.values()) {
    if (vehicle.destroyed) continue;
    const distance = Math.hypot(vehicle.x - x, vehicle.y - y);
    if (distance >= nearestDistance) continue;
    nearest = vehicle;
    nearestDistance = distance;
  }
  return nearest;
}

function joinOptions(clientId: number): {name: string} {
  return {name: `Load Driver ${clientId + 1}`};
}

async function sampleHealth(endpoint: string): Promise<void> {
  const url = `${endpoint.replace(/^ws/, 'http').replace(/\/$/, '')}/health`;
  try {
    const response = await fetch(url);
    const body = await response.json() as {
      memory?: {rssMb?: number};
      simulation?: {physics?: {stepMs?: {p95?: number}}};
      eventLoopDelayMs?: {p99?: number};
    };
    if (!response.ok) unhealthySamples++;
    maximumRssMb = Math.max(maximumRssMb, body.memory?.rssMb ?? 0);
    maximumPhysicsP95Ms = Math.max(
      maximumPhysicsP95Ms,
      body.simulation?.physics?.stepMs?.p95 ?? 0
    );
    maximumEventLoopP99Ms = Math.max(maximumEventLoopP99Ms, body.eventLoopDelayMs?.p99 ?? 0);
    const rss = body.memory?.rssMb ?? 0;
    const physicsP95 = body.simulation?.physics?.stepMs?.p95 ?? 0;
    const eventLoopP99 = body.eventLoopDelayMs?.p99 ?? 0;
    rssSamples.push({
      elapsedMs: Math.max(0, Date.now() - healthSamplingStartedAt),
      rssMb: rss
    });
    highPhysicsSamples = consecutiveSamples(highPhysicsSamples, physicsP95 > 4);
    highEventLoopSamples = consecutiveSamples(highEventLoopSamples, eventLoopP99 > 100);
    highRssSamples = consecutiveSamples(highRssSamples, rss > 750);
    if (highPhysicsSamples >= SUSTAINED_THRESHOLD_SAMPLES) sustainedThresholdBreaches.add('physics-p95');
    if (highEventLoopSamples >= SUSTAINED_THRESHOLD_SAMPLES) {
      sustainedThresholdBreaches.add('event-loop-p99');
    }
    if (highRssSamples >= SUSTAINED_THRESHOLD_SAMPLES) sustainedThresholdBreaches.add('rss');
  } catch (error) {
    unhealthySamples++;
    console.error('[loadtest] health request failed', error);
  }
}

function consecutiveSamples(previous: number, failed: boolean): number {
  return failed ? previous + 1 : 0;
}

function postWarmupRssGrowth(): number {
  const warm = rssSamples.find((sample) => sample.elapsedMs >= RSS_WARMUP_MS);
  const final = rssSamples.at(-1);
  if (!warm || !final) return 0;
  return Math.round((final.rssMb - warm.rssMb) * 100) / 100;
}

function loadMapPlanner(): MapRoutePlanner {
  const document = JSON.parse(readFileSync(
    new URL('../../public/assets/maps/district-lanes.json', import.meta.url),
    'utf8'
  )) as MapRouteDocument;
  return new MapRoutePlanner(document);
}

function normalizeAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}
