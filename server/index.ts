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
import {DistrictRoom} from './district-room.ts';
import {initializePhysicsEngine} from '../shared/physics/physics-world.ts';
import {CollisionMap} from './world-map.ts';

const port = Number(process.env.PORT ?? process.env.GAME_PORT ?? 2567);
const serveNext = process.env.NODE_ENV === 'production';
const nextApp = serveNext ? next({dev: false, hostname: '0.0.0.0', port}) : undefined;
await nextApp?.prepare();
const processStartedAt = Date.now();
// Fail the process before Railway marks it healthy if required runtime map assets are absent.
CollisionMap.load();
await initializePhysicsEngine();
const eventLoopDelay = monitorEventLoopDelay({resolution: 10});
eventLoopDelay.enable();
const app = express();
app.use(cors({origin: true, credentials: true}));
app.use(express.json());
app.get('/health', (_request, response) => {
  response.json({
    status: 'ok',
    room: 'district',
    region: process.env.RAILWAY_REPLICA_REGION ?? process.env.GAME_REGION ?? 'local',
    replicaId: process.env.RAILWAY_REPLICA_ID ?? 'local',
    buildId: process.env.RAILWAY_GIT_COMMIT_SHA ?? process.env.GIT_COMMIT_SHA ??
      process.env.RAILWAY_DEPLOYMENT_ID ?? 'development',
    startedAt: processStartedAt,
    uptimeSeconds: Math.round(process.uptime()),
    memoryRssMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
    eventLoopDelayMs: {
      p50: nanosToMillis(eventLoopDelay.percentile(50)),
      p95: nanosToMillis(eventLoopDelay.percentile(95)),
      p99: nanosToMillis(eventLoopDelay.percentile(99)),
      max: nanosToMillis(eventLoopDelay.max)
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
  transport: new WebSocketTransport({server: httpServer})
});
gameServer.define('district', DistrictRoom);

await gameServer.listen(port, '0.0.0.0');
console.log(`NOCK0 district server listening on http://localhost:${port}`);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    await gameServer.gracefullyShutdown(false);
    process.exit(0);
  });
}

function nanosToMillis(value: number): number {
  return Math.round(value / 1_000_000 * 100) / 100;
}
