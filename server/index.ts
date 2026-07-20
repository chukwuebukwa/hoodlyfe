import './schema-capacity.ts';
import {Server} from '@colyseus/core';
import {WebSocketTransport} from '@colyseus/ws-transport';
import cors from 'cors';
import express from 'express';
import {existsSync} from 'node:fs';
import {createServer} from 'node:http';
import {monitorEventLoopDelay} from 'node:perf_hooks';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import next from 'next';
import {DistrictPlaytestRoom, DistrictRoom} from './district-room.ts';
import {initializePhysicsEngine} from '../shared/physics/physics-world.ts';
import {CollisionMap} from './world-map.ts';
import {RuntimeHealthMonitor} from './runtime-health.ts';

const port = Number(process.env.PORT ?? process.env.GAME_PORT ?? 2567);
const serveNext = process.env.NODE_ENV === 'production';
const nextApp = serveNext ? next({dev: false, hostname: '0.0.0.0', port}) : undefined;
await nextApp?.prepare();
const processStartedAt = Date.now();
const runtimeHealth = new RuntimeHealthMonitor();
// Fail the process before Railway marks it healthy if required runtime map assets are absent.
CollisionMap.load();
await initializePhysicsEngine();
const eventLoopDelay = monitorEventLoopDelay({resolution: 10});
eventLoopDelay.enable();
let eventLoopWindowStartedAt = Date.now();
setInterval(() => {
  eventLoopDelay.reset();
  eventLoopWindowStartedAt = Date.now();
}, 60_000).unref();
const app = express();
app.use(cors({origin: true, credentials: true}));
app.use(express.json());
app.get('/health', (_request, response) => {
  const now = Date.now();
  const healthy = runtimeHealth.isHealthy(now, 2_000);
  const simulation = runtimeHealth.snapshot(now);
  const memory = memorySnapshot();
  response.status(healthy ? 200 : 503).json({
    status: healthy ? 'ok' : 'unhealthy',
    room: 'district',
    region: process.env.RAILWAY_REPLICA_REGION ?? process.env.GAME_REGION ?? 'local',
    replicaId: process.env.RAILWAY_REPLICA_ID ?? 'local',
    buildId: process.env.RAILWAY_GIT_COMMIT_SHA ?? process.env.GIT_COMMIT_SHA ??
      process.env.RAILWAY_DEPLOYMENT_ID ?? 'development',
    startedAt: processStartedAt,
    uptimeSeconds: Math.round(process.uptime()),
    memoryRssMb: memory.rssMb,
    memory,
    simulation,
    eventLoopDelayMs: {
      p50: nanosToMillis(eventLoopDelay.percentile(50)),
      p95: nanosToMillis(eventLoopDelay.percentile(95)),
      p99: nanosToMillis(eventLoopDelay.percentile(99)),
      max: nanosToMillis(eventLoopDelay.max),
      windowStartedAt: eventLoopWindowStartedAt
    }
  });
});

const distPath = fileURLToPath(new URL('../dist', import.meta.url));
if (existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get('/creator', (_request, response) => {
    response.sendFile(path.join(distPath, 'creator.html'));
  });
}

if (nextApp) {
  const nextHandler = nextApp.getRequestHandler();
  app.all('*', (request, response, nextMiddleware) => {
    nextHandler(request, response).catch(nextMiddleware);
  });
}

const httpServer = createServer(app);
const gameServer = new Server({
  greet: false,
  gracefullyShutdown: false,
  transport: new WebSocketTransport({
    server: httpServer,
    // Allow transient edge, mobile, and background-tab stalls without retaining
    // genuinely dead sockets indefinitely.
    pingInterval: 5_000,
    pingMaxRetries: 6
  })
});
let fatalShutdownPromise: Promise<unknown> | undefined;
const requestFatalShutdown = (error: Error): void => {
  if (fatalShutdownPromise) return;
  runtimeHealth.fail(error, 'fatal-shutdown');
  runtimeHealth.beginShutdown();
  const forcedExit = setTimeout(() => {
    console.error('[server] graceful shutdown timed out; forcing exit', error);
    process.exit(1);
  }, 10_000);
  forcedExit.unref();
  fatalShutdownPromise = gameServer.gracefullyShutdown(true, error).catch((shutdownError) => {
    console.error('[server] graceful shutdown failed', shutdownError);
    process.exitCode = 1;
  });
};
gameServer.define('district', DistrictRoom, {runtimeHealth, fatalShutdown: requestFatalShutdown});
gameServer.define('district-playtest', DistrictPlaytestRoom)
  .filterBy(['assetSourceId', 'revisionId']);

await gameServer.listen(port, '0.0.0.0');
console.log(`NOCK0 district server listening on http://localhost:${port}`);

setInterval(() => {
  if (!runtimeHealth.shouldFailForStall(Date.now(), 5_000)) return;
  const snapshot = runtimeHealth.snapshot();
  const error = new Error(
    `District simulation stalled for ${snapshot.lastSuccessfulTickAgeMs ?? 0}ms ` +
    `after tick ${snapshot.lastSuccessfulTick}.`
  );
  runtimeHealth.fail(error, 'simulation-watchdog', snapshot.currentPhase);
  requestFatalShutdown(error);
}, 1_000).unref();

process.on('uncaughtExceptionMonitor', (error, origin) => {
  console.error('[server] uncaught exception', {origin, error});
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    runtimeHealth.beginShutdown();
    await gameServer.gracefullyShutdown(false);
    process.exit(0);
  });
}

function nanosToMillis(value: number): number {
  return Math.round(value / 1_000_000 * 100) / 100;
}

function memorySnapshot(): {
  rssMb: number;
  heapUsedMb: number;
  heapTotalMb: number;
  externalMb: number;
  arrayBuffersMb: number;
} {
  const memory = process.memoryUsage();
  const mb = (value: number) => Math.round(value / 1024 / 1024 * 100) / 100;
  return {
    rssMb: mb(memory.rss),
    heapUsedMb: mb(memory.heapUsed),
    heapTotalMb: mb(memory.heapTotal),
    externalMb: mb(memory.external),
    arrayBuffersMb: mb(memory.arrayBuffers)
  };
}
