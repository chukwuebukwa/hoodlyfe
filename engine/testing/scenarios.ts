/**
 * Golden crash scenarios — the shared script library behind both the visual
 * A/B harness (engine/bench/harness.html) and the pinned hash fixtures
 * (test/engine/golden-scenarios.test.ts). Everything here is deterministic
 * pure data + pure functions of the tick, so the same scenario can be run
 * through the engine, or re-run years later to compare against pinned hashes.
 *
 * Browser-safe: no Node imports.
 */

import {vehicleDefinition} from '../../shared/content/vehicle-catalog.ts';
import {LAYER_HUMANOID, LAYER_VEHICLE, type EngineBody, type WorldState} from '../core/types';
import {createTileWorld, type TileWorld} from '../world/tile-world';
import {createWorldState, findBody, upsertBody} from '../world/world-state';
import {stepDynamics} from '../solvers/integrate';
import {driveVehicleState, vehicleHandlingForKind, type VehicleKernelCommand} from '../solvers/vehicle-kernel';
import {DEFAULT_CONTACT_TUNING, type ContactTuning, type ResolveResult} from '../solvers/vehicle-contact';

export interface ScenarioGeometry {
  width: number;
  height: number;
  tileWidth: number;
  tileHeight: number;
  collisions: number[];
}

export interface ScenarioVehicle {
  id: string;
  kind: string;
  x: number;
  y: number;
  angle: number;
  linvelX?: number;
  linvelY?: number;
  /** Deterministic pure function of the tick. */
  command: (tick: number) => VehicleKernelCommand;
}

export interface ScenarioPedestrian {
  id: string;
  x: number;
  y: number;
  linvelX?: number;
  linvelY?: number;
}

export interface Scenario {
  name: string;
  title: string;
  description: string;
  ticks: number;
  geometry: ScenarioGeometry;
  vehicles: ScenarioVehicle[];
  pedestrians: ScenarioPedestrian[];
}

// Pedestrian mass matches the live adapter (density 0.4 on an r=11 ball —
// inherited from the Rapier era); vehicle masses come from the catalog,
// exactly as PhysicsWorld.registerVehicle sets them.
export const PEDESTRIAN_RADIUS = 11;
export const PEDESTRIAN_MASS = 0.4 * Math.PI * PEDESTRIAN_RADIUS * PEDESTRIAN_RADIUS;
export const VEHICLE_RESTITUTION = 0.2;
export const VEHICLE_FRICTION = 0.6;

// Scenario pedestrians are undriven. In the live game the on-foot controller
// rewrites ped velocity every tick, so knockback never persists; without that
// driver a shoved ped would coast and ricochet forever. This ground damping
// stands in for the controller: v *= 1/(1+k·dt) (Rapier's damping formula),
// skidding a launched ped to rest in roughly half a second.
export const PEDESTRIAN_GROUND_DAMPING = 8;

export function dampPedestrianVelocity(
  velocity: {linvelX: number; linvelY: number},
  dt: number
): void {
  const factor = 1 / (1 + PEDESTRIAN_GROUND_DAMPING * dt);
  velocity.linvelX *= factor;
  velocity.linvelY *= factor;
}

/** Bordered arena; extra blocked tiles given as [col, row] pairs. */
function arena(width: number, height: number, extra: Array<[number, number]> = []): ScenarioGeometry {
  const collisions = Array.from({length: width * height}, (_, i) => {
    const col = i % width;
    const row = Math.floor(i / width);
    return col === 0 || row === 0 || col === width - 1 || row === height - 1 ? 1 : 0;
  });
  for (const [col, row] of extra) collisions[row * width + col] = 1;
  return {width, height, tileWidth: 64, tileHeight: 64, collisions};
}

const drive = (steering: number, throttle: number, handbrake = false) =>
  (): VehicleKernelCommand => ({steering, throttle, handbrake});

export const SCENARIOS: Scenario[] = [
  {
    name: 'head-on-wall',
    title: 'Head-on wall crash',
    description: 'Full throttle straight into the east wall. Watch rebound (restitution) and that the car does not jitter or sink into the wall.',
    ticks: 300,
    geometry: arena(20, 10),
    vehicles: [
      {id: 'car:a', kind: 'sedan', x: 200, y: 320, angle: 0, command: drive(0, 1)},
    ],
    pedestrians: [],
  },
  {
    name: 'glancing-scrape',
    title: 'Glancing wall scrape',
    description: 'Shallow-angle contact with the north wall at speed. The car should retain most tangential speed and scrape along, not stick or bounce off hard.',
    ticks: 300,
    geometry: arena(24, 10),
    vehicles: [
      {
        id: 'car:a', kind: 'sedan', x: 160, y: 190, angle: -0.14,
        linvelX: 320 * Math.cos(-0.14), linvelY: 320 * Math.sin(-0.14),
        command: drive(0, 1),
      },
    ],
    pedestrians: [],
  },
  {
    name: 't-bone',
    title: 'T-bone spin-out',
    description: 'Eastbound car struck broadside by a fast southbound car at the intersection. Watch spin magnitude (inertiaScale/spinResponse) and post-impact trajectories.',
    ticks: 360,
    geometry: arena(20, 20),
    vehicles: [
      {id: 'car:a', kind: 'sedan', x: 420, y: 640, angle: 0, linvelX: 170, command: drive(0, 0.55)},
      {
        id: 'car:b', kind: 'r33', x: 640, y: 180, angle: Math.PI / 2,
        linvelY: 340, command: drive(0, 1),
      },
    ],
    pedestrians: [],
  },
  {
    name: 'pileup',
    title: 'Three-car pileup',
    description: 'Stopped car rear-ended by two cars arriving at speed. Watch stacking behavior, chain impulse transfer, and that the pile settles without jitter.',
    ticks: 420,
    geometry: arena(26, 10),
    vehicles: [
      {id: 'car:lead', kind: 'taxi', x: 1180, y: 320, angle: 0, command: drive(0, 0)},
      {id: 'car:mid', kind: 'sedan', x: 700, y: 320, angle: 0, linvelX: 300, command: drive(0, 1)},
      {id: 'car:rear', kind: 'police', x: 260, y: 335, angle: 0, linvelX: 380, command: drive(0, 1)},
    ],
    pedestrians: [],
  },
  {
    name: 'ped-plow',
    title: 'Pedestrian crowd plow',
    description: 'Car drives through a crowd. Dominance means peds never deflect the car; peds should be shoved aside, not tunneled through or launched absurdly.',
    ticks: 360,
    geometry: arena(24, 14),
    vehicles: [
      {id: 'car:a', kind: 'sedan', x: 180, y: 448, angle: 0, linvelX: 240, command: drive(0, 0.9)},
    ],
    pedestrians: Array.from({length: 12}, (_, i) => ({
      id: `ped:${String(i).padStart(2, '0')}`,
      x: 760 + (i % 4) * 46,
      y: 380 + Math.floor(i / 4) * 46,
    })),
  },
  {
    name: 'pillar-clip',
    title: 'Corner pillar clip',
    description: 'High-speed corner clip on a lone pillar tile. Watch the glance-off direction and that interior-face culling keeps the contact normal clean.',
    ticks: 300,
    geometry: arena(20, 14, [[10, 7]]),
    vehicles: [
      {
        id: 'car:a', kind: 's15', x: 180, y: 390, angle: 0.09,
        linvelX: 380 * Math.cos(0.09), linvelY: 380 * Math.sin(0.09),
        command: drive(0, 1),
      },
    ],
    pedestrians: [],
  },
];

export function scenarioByName(name: string): Scenario {
  const scenario = SCENARIOS.find((s) => s.name === name);
  if (!scenario) throw new Error(`unknown scenario: ${name}`);
  return scenario;
}

export function scenarioVehicleBody(vehicle: ScenarioVehicle): EngineBody {
  const definition = vehicleDefinition(vehicle.kind);
  return {
    id: vehicle.id,
    layer: LAYER_VEHICLE,
    mask: LAYER_VEHICLE | LAYER_HUMANOID,
    shape: {
      kind: 'box',
      halfLength: definition.collision.length / 2,
      halfWidth: definition.collision.width / 2,
    },
    mass: definition.mass,
    restitution: VEHICLE_RESTITUTION,
    friction: VEHICLE_FRICTION,
    dominance: 1,
    state: {
      x: vehicle.x, y: vehicle.y, angle: vehicle.angle,
      linvelX: vehicle.linvelX ?? 0, linvelY: vehicle.linvelY ?? 0, angvel: 0,
    },
  };
}

export function scenarioPedestrianBody(pedestrian: ScenarioPedestrian): EngineBody {
  return {
    id: pedestrian.id,
    layer: LAYER_HUMANOID,
    mask: LAYER_VEHICLE | LAYER_HUMANOID,
    shape: {kind: 'circle', radius: PEDESTRIAN_RADIUS},
    mass: PEDESTRIAN_MASS,
    restitution: 0,
    friction: VEHICLE_FRICTION,
    dominance: 0,
    state: {
      x: pedestrian.x, y: pedestrian.y, angle: 0,
      linvelX: pedestrian.linvelX ?? 0, linvelY: pedestrian.linvelY ?? 0, angvel: 0,
    },
  };
}

export interface EngineScenarioRun {
  scenario: Scenario;
  tiles: TileWorld;
  state: WorldState;
  /** Tick index of the NEXT step (0 before the first step). */
  tick: number;
  step: (tuning?: ContactTuning) => ResolveResult;
}

export function createEngineScenarioRun(scenario: Scenario): EngineScenarioRun {
  const tiles = createTileWorld(scenario.geometry);
  const state = createWorldState();
  for (const vehicle of scenario.vehicles) upsertBody(state, scenarioVehicleBody(vehicle));
  for (const pedestrian of scenario.pedestrians) upsertBody(state, scenarioPedestrianBody(pedestrian));
  const handlings = new Map(scenario.vehicles.map((v) => [v.id, vehicleHandlingForKind(v.kind)]));

  const run: EngineScenarioRun = {
    scenario,
    tiles,
    state,
    tick: 0,
    step(tuning = DEFAULT_CONTACT_TUNING) {
      const dt = 1 / 60;
      for (const vehicle of scenario.vehicles) {
        const body = findBody(state, vehicle.id);
        if (!body) continue;
        driveVehicleState(body.state, vehicle.command(run.tick), handlings.get(vehicle.id)!, dt);
      }
      const result = stepDynamics(tiles, state, dt, tuning);
      for (const pedestrian of scenario.pedestrians) {
        const body = findBody(state, pedestrian.id);
        if (body) dampPedestrianVelocity(body.state, dt);
      }
      run.tick += 1;
      return result;
    },
  };
  return run;
}
