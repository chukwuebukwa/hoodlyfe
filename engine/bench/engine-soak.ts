/**
 * Engine soak benchmark: N vehicles + M pedestrians in a walled arena with
 * pillar obstacles, stepped at 60 Hz for a simulated duration. Reports per-
 * tick timing percentiles. Budget target: p99 well under 2 ms at 2× current
 * peak entity counts.
 *
 * Run: npx tsx engine/bench/engine-soak.ts [vehicles] [pedestrians] [seconds]
 */

import {createTileWorld} from '../world/tile-world';
import {createWorldState, upsertBody, findBody} from '../world/world-state';
import {stepDynamics} from '../solvers/integrate';
import {driveVehicleState, vehicleHandlingForKind} from '../solvers/vehicle-kernel';
import {hashWorldState} from '../world/snapshot';
import {createWorldHistory, recordSnapshot} from '../world/history';
import {LAYER_HUMANOID, LAYER_VEHICLE, type EngineBody} from '../core/types';

const vehicles = Number(process.argv[2] ?? 48);
const pedestrians = Number(process.argv[3] ?? 120);
const seconds = Number(process.argv[4] ?? 30);

const SIZE = 60;
const geometry = {
  width: SIZE,
  height: SIZE,
  tileWidth: 64,
  tileHeight: 64,
  collisions: Array.from({length: SIZE * SIZE}, (_, i) => {
    const col = i % SIZE;
    const row = Math.floor(i / SIZE);
    if (col === 0 || row === 0 || col === SIZE - 1 || row === SIZE - 1) return 1;
    return col % 9 === 0 && row % 7 === 0 ? 1 : 0; // pillar field
  }),
};

// Simple deterministic LCG so the bench is reproducible.
let seed = 0x2f6e2b1;
function random(): number {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
}

const tiles = createTileWorld(geometry);
const state = createWorldState();
const history = createWorldHistory();
const handling = vehicleHandlingForKind('sedan');

for (let i = 0; i < vehicles; i++) {
  const body: EngineBody = {
    id: `vehicle:${String(i).padStart(3, '0')}`,
    layer: LAYER_VEHICLE,
    mask: LAYER_VEHICLE | LAYER_HUMANOID,
    shape: {kind: 'box', halfLength: 40, halfWidth: 18},
    mass: 1200,
    restitution: 0.2,
    friction: 0.6,
    dominance: 1,
    state: {
      x: 100 + random() * (SIZE - 4) * 60,
      y: 100 + random() * (SIZE - 4) * 60,
      angle: random() * Math.PI * 2,
      linvelX: 0,
      linvelY: 0,
      angvel: 0,
    },
  };
  upsertBody(state, body);
}
for (let i = 0; i < pedestrians; i++) {
  upsertBody(state, {
    id: `ped:${String(i).padStart(3, '0')}`,
    layer: LAYER_HUMANOID,
    mask: LAYER_VEHICLE | LAYER_HUMANOID,
    shape: {kind: 'circle', radius: 11},
    mass: 22,
    restitution: 0,
    friction: 0.6,
    dominance: 0,
    state: {
      x: 100 + random() * (SIZE - 4) * 60,
      y: 100 + random() * (SIZE - 4) * 60,
      angle: 0,
      linvelX: (random() - 0.5) * 120,
      linvelY: (random() - 0.5) * 120,
      angvel: 0,
    },
  });
}

const ticks = Math.floor(seconds * 60);
const durations: number[] = [];
const dt = 1 / 60;

for (let tick = 0; tick < ticks; tick++) {
  const start = process.hrtime.bigint();

  // Drive vehicles with wandering inputs through the real kernel.
  for (let i = 0; i < vehicles; i++) {
    const body = findBody(state, `vehicle:${String(i).padStart(3, '0')}`)!;
    const command = {
      steering: Math.sin(tick / 90 + i) * 0.6,
      throttle: 0.8,
      handbrake: false,
    };
    // Kernel writes desired velocities only; the resolver integrates pose.
    driveVehicleState(body.state, command, handling, dt);
  }

  stepDynamics(tiles, state, dt);
  recordSnapshot(history, state);

  durations.push(Number(process.hrtime.bigint() - start) / 1e6);
}

durations.sort((a, b) => a - b);
const pick = (q: number) => durations[Math.min(durations.length - 1, Math.floor(q * durations.length))];
console.log(JSON.stringify({
  vehicles,
  pedestrians,
  ticks,
  finalHash: hashWorldState(state),
  ms: {
    mean: durations.reduce((a, b) => a + b, 0) / durations.length,
    p50: pick(0.5),
    p95: pick(0.95),
    p99: pick(0.99),
    max: durations[durations.length - 1],
  },
}, null, 2));
