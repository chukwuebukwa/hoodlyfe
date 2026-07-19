// Determinism contract: register bodies in deterministic order, drive with
// deterministic velocities, step at the fixed timestep. Two worlds built from the
// same geometry then produce bit-identical states.

import RAPIER from '@dimforge/rapier2d-compat';
import {vehicleDefinition} from '../content/vehicle-catalog.ts';

export const PHYSICS_TIMESTEP_SECONDS = 1 / 30;
const VEHICLE_RESTITUTION = 0.2;
const VEHICLE_FRICTION = 0.6;
const HUMANOID_DENSITY = 0.4;
const STATIC_MEMBERSHIP = 0x0001;
const DYNAMIC_MEMBERSHIP = 0x0002;

export type PhysicsContactScope = 'all' | 'statics-only';

let engineReady: Promise<void> | undefined;

export function initializePhysicsEngine(): Promise<void> {
  engineReady ??= RAPIER.init().then(() => undefined);
  return engineReady;
}

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

export class PhysicsWorld {
  readonly staticColliderCount: number;
  private readonly world: RAPIER.World;
  private readonly bodies = new Map<string, RAPIER.RigidBody>();
  private freed = false;

  private constructor(geometry: PhysicsWorldGeometry) {
    this.world = new RAPIER.World({x: 0, y: 0});
    this.world.timestep = PHYSICS_TIMESTEP_SECONDS;
    this.staticColliderCount = this.meshStatics(geometry) + this.buildBorderWalls(geometry);
  }

  static create(geometry: PhysicsWorldGeometry): PhysicsWorld {
    if (!engineReady) {
      throw new Error('initializePhysicsEngine() must resolve before creating a world.');
    }
    return new PhysicsWorld(geometry);
  }

  registerVehicle(
    key: string,
    kind: string,
    state: PhysicsBodyState,
    contactScope: PhysicsContactScope = 'all'
  ): void {
    const collision = vehicleDefinition(kind).collision;
    this.register(
      key,
      state,
      RAPIER.ColliderDesc.cuboid(collision.length / 2, collision.width / 2)
        .setDensity(1)
        .setRestitution(VEHICLE_RESTITUTION)
        .setFriction(VEHICLE_FRICTION)
        .setCollisionGroups(dynamicGroups(contactScope))
    );
  }

  registerHumanoid(key: string, radius: number, state: PhysicsBodyState): void {
    this.register(
      key,
      state,
      RAPIER.ColliderDesc.ball(radius)
        .setDensity(HUMANOID_DENSITY)
        .setFriction(VEHICLE_FRICTION)
        .setCollisionGroups(dynamicGroups('all'))
    );
  }

  remove(key: string): void {
    const body = this.bodies.get(key);
    if (!body) return;
    this.world.removeRigidBody(body);
    this.bodies.delete(key);
  }

  has(key: string): boolean {
    return this.bodies.has(key);
  }

  keys(): IterableIterator<string> {
    return this.bodies.keys();
  }

  setVelocity(key: string, linvelX: number, linvelY: number, angvel: number): void {
    const body = this.bodies.get(key);
    if (!body) return;
    body.setLinvel({x: finiteOrZero(linvelX), y: finiteOrZero(linvelY)}, true);
    body.setAngvel(finiteOrZero(angvel), true);
  }

  writeback(key: string, state: PhysicsBodyState): void {
    const body = this.bodies.get(key);
    if (!body) return;
    body.setTranslation({x: state.x, y: state.y}, true);
    body.setRotation(state.rotation, true);
    body.setLinvel({x: state.linvelX, y: state.linvelY}, true);
    body.setAngvel(state.angvel, true);
  }

  writebackAll(states: ReadonlyMap<string, PhysicsBodyState>): void {
    for (const [key, state] of states) this.writeback(key, state);
  }

  capture(key: string): PhysicsBodyState | undefined {
    const body = this.bodies.get(key);
    if (!body) return undefined;
    const translation = body.translation();
    const linvel = body.linvel();
    return {
      x: translation.x,
      y: translation.y,
      rotation: body.rotation(),
      linvelX: linvel.x,
      linvelY: linvel.y,
      angvel: body.angvel()
    };
  }

  captureAll(): Map<string, PhysicsBodyState> {
    const states = new Map<string, PhysicsBodyState>();
    for (const key of this.bodies.keys()) {
      const state = this.capture(key);
      if (state) states.set(key, state);
    }
    return states;
  }

  step(): void {
    this.world.step();
  }

  free(): void {
    if (this.freed) return;
    this.freed = true;
    this.world.free();
  }

  private register(key: string, state: PhysicsBodyState, collider: RAPIER.ColliderDesc): void {
    if (this.bodies.has(key)) {
      throw new Error(`Physics body already registered for key "${key}".`);
    }
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(finiteOrZero(state.x), finiteOrZero(state.y))
        .setRotation(finiteOrZero(state.rotation))
        .setLinvel(finiteOrZero(state.linvelX), finiteOrZero(state.linvelY))
        .setAngvel(finiteOrZero(state.angvel))
        .setCcdEnabled(true)
    );
    this.world.createCollider(collider, body);
    this.bodies.set(key, body);
  }

  private meshStatics(geometry: PhysicsWorldGeometry): number {
    let count = 0;
    for (let row = 0; row < geometry.height; row++) {
      let runStart = -1;
      for (let column = 0; column <= geometry.width; column++) {
        const blocked = column < geometry.width &&
          geometry.collisions[row * geometry.width + column] !== 0;
        if (blocked && runStart < 0) runStart = column;
        if (!blocked && runStart >= 0) {
          const runLength = column - runStart;
          const halfWidth = (runLength * geometry.tileWidth) / 2;
          const halfHeight = geometry.tileHeight / 2;
          this.createStatic(
            runStart * geometry.tileWidth + halfWidth,
            row * geometry.tileHeight + halfHeight,
            halfWidth,
            halfHeight
          );
          count++;
          runStart = -1;
        }
      }
    }
    return count;
  }

  // Tile data leaves border cells open; only CollisionMap's code blocks out-of-bounds,
  // so the physical world needs explicit walls.
  private buildBorderWalls(geometry: PhysicsWorldGeometry): number {
    const worldWidth = geometry.width * geometry.tileWidth;
    const worldHeight = geometry.height * geometry.tileHeight;
    const tile = Math.max(geometry.tileWidth, geometry.tileHeight);
    const walls = [
      {x: worldWidth / 2, y: -tile / 2, hx: worldWidth / 2 + tile, hy: tile / 2},
      {x: worldWidth / 2, y: worldHeight + tile / 2, hx: worldWidth / 2 + tile, hy: tile / 2},
      {x: -tile / 2, y: worldHeight / 2, hx: tile / 2, hy: worldHeight / 2 + tile},
      {x: worldWidth + tile / 2, y: worldHeight / 2, hx: tile / 2, hy: worldHeight / 2 + tile}
    ];
    for (const wall of walls) this.createStatic(wall.x, wall.y, wall.hx, wall.hy);
    return walls.length;
  }

  private createStatic(x: number, y: number, halfWidth: number, halfHeight: number): void {
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, y));
    this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(halfWidth, halfHeight)
        .setCollisionGroups((STATIC_MEMBERSHIP << 16) | 0xffff),
      body
    );
  }
}

function dynamicGroups(contactScope: PhysicsContactScope): number {
  const filter = contactScope === 'statics-only'
    ? STATIC_MEMBERSHIP
    : STATIC_MEMBERSHIP | DYNAMIC_MEMBERSHIP;
  return (DYNAMIC_MEMBERSHIP << 16) | filter;
}

function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? value : 0;
}
