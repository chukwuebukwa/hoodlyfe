import './schema-capacity.ts';
import {Server} from '@colyseus/core';
import {WebSocketTransport} from '@colyseus/ws-transport';
import cors from 'cors';
import express from 'express';
import {existsSync} from 'node:fs';
import {createServer} from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {DistrictRoom} from './district-room.ts';

const port = Number(process.env.PORT ?? process.env.GAME_PORT ?? 2567);
const app = express();
app.use(cors({origin: true, credentials: true}));
app.use(express.json());
app.get('/health', (_request, response) => {
  response.json({status: 'ok', room: 'district'});
});

const distPath = fileURLToPath(new URL('../dist', import.meta.url));
if (existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get('/creator', (_request, response) => {
    response.sendFile(path.join(distPath, 'creator.html'));
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
