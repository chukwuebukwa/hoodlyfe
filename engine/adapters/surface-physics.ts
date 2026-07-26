/**
 * Drop-in replacement for the retired Rapier-backed PhysicsWorld
 * (shared/physics/physics-world.ts), implemented on the engine: TileWorld
 * statics + WorldState bodies + the sequential-impulse resolver. It preserves
 * the exact API the game consumes — registerVehicle/registerHumanoid,
 * writeback/synchronizeVelocity/teleport, step, capture, contacts,
 * hasStaticImpact, fork-per-surface — so vehicle-body-drive and
 * vehicle-simulation-controller run unchanged.
 *
 * The pose contract carries over untouched: writeback stores the PRE-kernel
 * pose plus the kernel's desired velocities, and step() integrates the pose —
 * the resolver is the sole pose integrator (see engine/README.md).
 */

import {vehicleDefinition} from '../../shared/content/vehicle-catalog.ts';
import {SIMULATION_STEP_SECONDS} from '../../shared/simulation/timing.ts';
import {
  LAYER_HUMANOID,
  LAYER_PROP,
  LAYER_VEHICLE,
  STATIC_BODY_ID,
  type EngineBody,
  type WorldState,
} from '../core/types';
import {createTileWorld, type TileWorld} from '../world/tile-world';
import {createWorldState, findBody, removeBody, upsertBody} from '../world/world-state';
import {stepDynamics} from '../solvers/integrate';
import type {ResolveResult} from '../solvers/vehicle-contact';

export const PHYSICS_TIMESTEP_SECONDS = SIMULATION_STEP_SECONDS;
const VEHICLE_RESTITUTION = 0.2;
const VEHICLE_FRICTION = 0.6;
const HUMANOID_DENSITY = 0.4;
const STATIC_IMPACT_MIN_APPROACH_SPEED = 1;

export interface PhysicsBodyState {
  x: number;
  y: number;
  rotation: number;
  linvelX: number;
  linvelY: number;
  angvel: number;
}

export interface PhysicsWorldGeometry {
  readonly width: number;
  readonly height: number;
  readonly tileWidth: number;
  readonly tileHeight: number;
  readonly collisions: readonly number[];
}

export interface PhysicsContact {
  readonly first: string;
  readonly second: string;
  readonly normalX: number;
  readonly normalY: number;
  readonly impulse: number;
}

/** Kept for API compatibility; the engine needs no async initialization. */
export function initializePhysicsEngine(): Promise<void> {
  return Promise.resolve();
}

export class PhysicsWorld {
  readonly staticColliderCount: number;
  private readonly solidTiles: TileWorld;
  private readonly openTiles: TileWorld;
  private tiles: TileWorld;
  private readonly state: WorldState = createWorldState();
  private readonly identities = new Map<string, number>();
  private readonly children = new Set<PhysicsWorld>();
  private lastResult: ResolveResult = {contacts: [], staticImpacts: new Map()};
  private nextIdentity = 1;
  private freed = false;

  private constructor(
    private readonly geometry: PhysicsWorldGeometry,
    includeStatics = true
  ) {
    this.solidTiles = createTileWorld({
      width: geometry.width,
      height: geometry.height,
      tileWidth: geometry.tileWidth,
      tileHeight: geometry.tileHeight,
      collisions: geometry.collisions,
    });
    // Statics-disabled surfaces (bridges, rooftops) collide with nothing
    // static inside the map; out-of-bounds stays intrinsically solid.
    this.openTiles = createTileWorld({
      width: geometry.width,
      height: geometry.height,
      tileWidth: geometry.tileWidth,
      tileHeight: geometry.tileHeight,
      collisions: new Array(geometry.width * geometry.height).fill(0),
    });
    this.tiles = includeStatics ? this.solidTiles : this.openTiles;
    this.staticColliderCount = includeStatics
      ? geometry.collisions.reduce((sum, cell) => sum + (cell !== 0 ? 1 : 0), 0)
      : 0;
  }

  static create(geometry: PhysicsWorldGeometry): PhysicsWorld {
    return new PhysicsWorld(geometry, true);
  }

  fork(includeStatics = false): PhysicsWorld {
    const child = new PhysicsWorld(this.geometry, includeStatics);
    this.children.add(child);
    return child;
  }

  registerVehicle(key: string, kind: string, state: PhysicsBodyState): void {
    const definition = vehicleDefinition(kind);
    this.register({
      id: key,
      layer: LAYER_VEHICLE,
      mask: LAYER_VEHICLE | LAYER_HUMANOID | LAYER_PROP,
      shape: {
        kind: 'box',
        halfLength: definition.collision.length / 2,
        halfWidth: definition.collision.width / 2,
      },
      mass: definition.mass,
      restitution: VEHICLE_RESTITUTION,
      friction: VEHICLE_FRICTION,
      dominance: 1,
      state: bodyStateFrom(state),
    });
  }

  registerHumanoid(key: string, radius: number, state: PhysicsBodyState): void {
    this.register({
      id: key,
      layer: LAYER_HUMANOID,
      mask: LAYER_VEHICLE | LAYER_HUMANOID | LAYER_PROP,
      shape: {kind: 'circle', radius},
      mass: HUMANOID_DENSITY * Math.PI * radius * radius,
      restitution: 0,
      friction: VEHICLE_FRICTION,
      dominance: 0,
      state: bodyStateFrom(state),
    });
  }

  remove(key: string): void {
    removeBody(this.state, key);
    this.identities.delete(key);
  }

  has(key: string): boolean {
    return findBody(this.state, key) !== undefined;
  }

  get bodyCount(): number {
    return this.state.bodies.length;
  }

  keys(): IterableIterator<string> {
    return this.state.bodies.map((body: EngineBody) => body.id).values();
  }

  setVelocity(key: string, linvelX: number, linvelY: number, angvel: number): void {
    const body = findBody(this.state, key);
    if (!body) return;
    body.state.linvelX = finiteOrZero(linvelX);
    body.state.linvelY = finiteOrZero(linvelY);
    body.state.angvel = finiteOrZero(angvel);
  }

  applyImpulse(key: string, impulseX: number, impulseY: number): void {
    const body = findBody(this.state, key);
    if (!body || body.mass <= 0) return;
    body.state.linvelX += finiteOrZero(impulseX) / body.mass;
    body.state.linvelY += finiteOrZero(impulseY) / body.mass;
  }

  shouldTeleport(key: string, state: PhysicsBodyState, teleportTolerance = 0.001): boolean {
    const body = findBody(this.state, key);
    if (!body) return false;
    return Math.hypot(
      body.state.x - finiteOrZero(state.x),
      body.state.y - finiteOrZero(state.y)
    ) > Math.max(0, teleportTolerance);
  }

  /** Velocity + heading authority without touching the integrated position. */
  synchronizeVelocity(key: string, state: PhysicsBodyState): void {
    const body = findBody(this.state, key);
    if (!body) return;
    body.state.angle = finiteOrZero(state.rotation);
    body.state.linvelX = finiteOrZero(state.linvelX);
    body.state.linvelY = finiteOrZero(state.linvelY);
    body.state.angvel = finiteOrZero(state.angvel);
  }

  teleport(key: string, state: PhysicsBodyState): void {
    const body = findBody(this.state, key);
    if (!body) return;
    Object.assign(body.state, bodyStateFrom(state));
  }

  bodyIdentity(key: string): number | undefined {
    return this.identities.get(key);
  }

  writeback(key: string, state: PhysicsBodyState): void {
    const body = findBody(this.state, key);
    if (!body) return;
    Object.assign(body.state, bodyStateFrom(state));
  }

  writebackAll(states: ReadonlyMap<string, PhysicsBodyState>): void {
    for (const [key, state] of states) this.writeback(key, state);
  }

  capture(key: string): PhysicsBodyState | undefined {
    const body = findBody(this.state, key);
    if (!body) return undefined;
    return {
      x: body.state.x,
      y: body.state.y,
      rotation: body.state.angle,
      linvelX: body.state.linvelX,
      linvelY: body.state.linvelY,
      angvel: body.state.angvel,
    };
  }

  captureAll(): Map<string, PhysicsBodyState> {
    const states = new Map<string, PhysicsBodyState>();
    for (const body of this.state.bodies) states.set(body.id, this.capture(body.id)!);
    return states;
  }

  step(): void {
    this.lastResult = stepDynamics(this.tiles, this.state, PHYSICS_TIMESTEP_SECONDS);
  }

  setStaticsEnabled(enabled: boolean): void {
    this.tiles = enabled ? this.solidTiles : this.openTiles;
  }

  /**
   * Dynamic-pair contacts from the last step, (first, second)-sorted. The
   * legacy Rapier wrapper reported normals pointing from `second` toward
   * `first`; the engine's Contact normal points first→second, so it is negated
   * here to preserve the consumer contract (applyHumanoidImpact projects
   * velocities onto it sign-sensitively).
   */
  contacts(): readonly PhysicsContact[] {
    const contacts: PhysicsContact[] = [];
    for (const contact of this.lastResult.contacts) {
      if (contact.first === STATIC_BODY_ID || contact.second === STATIC_BODY_ID) continue;
      contacts.push(Object.freeze({
        first: contact.first,
        second: contact.second,
        normalX: -contact.normalX,
        normalY: -contact.normalY,
        impulse: contact.impulse,
      }));
    }
    return Object.freeze(contacts);
  }

  /**
   * Whether the body hit the static world during the last step. The resolver
   * records the true peak approach speed per body, so no attempted-vs-achieved
   * displacement heuristic (the old WORLD_CONTACT_SHORTFALL) is needed.
   */
  hasStaticImpact(key: string, _linvelX?: number, _linvelY?: number): boolean {
    return (this.lastResult.staticImpacts.get(key) ?? 0) > STATIC_IMPACT_MIN_APPROACH_SPEED;
  }

  /**
   * Peak speed at which the body approached the static world during the last
   * step (0 when untouched). This is the *normal* component — a tangential
   * wall scrape reports only its small inward drift, not the full velocity —
   * which is what wall-impact damage must be scaled by.
   */
  staticImpactSpeed(key: string): number {
    return this.lastResult.staticImpacts.get(key) ?? 0;
  }

  free(): void {
    if (this.freed) return;
    this.freed = true;
    for (const child of this.children) child.free();
    this.children.clear();
    this.state.bodies.length = 0;
    this.identities.clear();
  }

  private register(body: EngineBody): void {
    if (findBody(this.state, body.id)) {
      throw new Error(`Physics body "${body.id}" is already registered.`);
    }
    upsertBody(this.state, body);
    this.identities.set(body.id, this.nextIdentity++);
  }
}

function bodyStateFrom(state: PhysicsBodyState) {
  return {
    x: finiteOrZero(state.x),
    y: finiteOrZero(state.y),
    angle: finiteOrZero(state.rotation),
    linvelX: finiteOrZero(state.linvelX),
    linvelY: finiteOrZero(state.linvelY),
    angvel: finiteOrZero(state.angvel),
  };
}

function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? value : 0;
}
