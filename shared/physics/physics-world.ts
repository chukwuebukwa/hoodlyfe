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
const VEHICLE_MEMBERSHIP = 0x0002;
const HUMANOID_MEMBERSHIP = 0x0004;

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

export interface PhysicsContact {
  readonly first: string;
  readonly second: string;
  readonly normalX: number;
  readonly normalY: number;
  readonly impulse: number;
}

export class PhysicsWorld {
  readonly staticColliderCount: number;
  private readonly world: RAPIER.World;
  private readonly bodies = new Map<string, RAPIER.RigidBody>();
  private readonly colliders = new Map<string, RAPIER.Collider>();
  private readonly colliderKeys = new Map<number, string>();
  private freed = false;

  private constructor(geometry: PhysicsWorldGeometry) {
    this.world = new RAPIER.World({x: 0, y: 0});
    this.world.timestep = PHYSICS_TIMESTEP_SECONDS;
    this.world.numSolverIterations = 8;
    this.world.maxCcdSubsteps = 4;
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
    state: PhysicsBodyState
  ): void {
    const definition = vehicleDefinition(kind);
    this.register(
      key,
      state,
      RAPIER.ColliderDesc.cuboid(
        definition.collision.length / 2,
        definition.collision.width / 2
      )
        .setMass(definition.mass)
        .setRestitution(VEHICLE_RESTITUTION)
        .setFriction(VEHICLE_FRICTION)
        .setCollisionGroups(groups(
          VEHICLE_MEMBERSHIP,
          STATIC_MEMBERSHIP | VEHICLE_MEMBERSHIP | HUMANOID_MEMBERSHIP
        )),
      true
    );
    this.bodies.get(key)!.setDominanceGroup(1);
  }

  registerHumanoid(key: string, radius: number, state: PhysicsBodyState): void {
    this.register(
      key,
      state,
      RAPIER.ColliderDesc.ball(radius)
        .setDensity(HUMANOID_DENSITY)
        .setFriction(VEHICLE_FRICTION)
        .setCollisionGroups(groups(
          HUMANOID_MEMBERSHIP,
          STATIC_MEMBERSHIP | VEHICLE_MEMBERSHIP
        )),
      false,
      radius
    );
  }

  remove(key: string): void {
    const body = this.bodies.get(key);
    if (!body) return;
    this.world.removeRigidBody(body);
    this.bodies.delete(key);
    const collider = this.colliders.get(key);
    if (collider) this.colliderKeys.delete(collider.handle);
    this.colliders.delete(key);
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

  contacts(): readonly PhysicsContact[] {
    const contacts: PhysicsContact[] = [];
    for (const [first, collider] of this.colliders) {
      this.world.contactPairsWith(collider, (other) => {
        const second = this.colliderKeys.get(other.handle);
        if (!second || first >= second) return;
        this.world.contactPair(collider, other, (manifold) => {
          if (manifold.numSolverContacts() === 0) return;
          const normal = manifold.normal();
          let impulse = 0;
          for (let index = 0; index < manifold.numContacts(); index++) {
            impulse = Math.max(impulse, manifold.contactImpulse(index));
          }
          contacts.push(Object.freeze({
            first,
            second,
            normalX: normal.x,
            normalY: normal.y,
            impulse
          }));
        });
      });
    }
    return Object.freeze(contacts.sort((left, right) => (
      left.first.localeCompare(right.first) || left.second.localeCompare(right.second)
    )));
  }

  hasStaticImpact(key: string, linvelX: number, linvelY: number): boolean {
    const collider = this.colliders.get(key);
    if (!collider) return false;
    let found = false;
    this.world.contactPairsWith(collider, (other) => {
      if (this.colliderKeys.has(other.handle)) return;
      this.world.contactPair(collider, other, (manifold) => {
        const normal = manifold.normal();
        if (
          manifold.numSolverContacts() > 0 &&
          linvelX * normal.x + linvelY * normal.y < -1
        ) found = true;
      });
    });
    return found;
  }

  free(): void {
    if (this.freed) return;
    this.freed = true;
    this.world.free();
  }

  private register(
    key: string,
    state: PhysicsBodyState,
    collider: RAPIER.ColliderDesc,
    lockRotation = false,
    softCcdPrediction = 0
  ): void {
    if (this.bodies.has(key)) {
      throw new Error(`Physics body already registered for key "${key}".`);
    }
    const bodyDescription = RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(finiteOrZero(state.x), finiteOrZero(state.y))
        .setRotation(finiteOrZero(state.rotation))
        .setLinvel(finiteOrZero(state.linvelX), finiteOrZero(state.linvelY))
        .setAngvel(finiteOrZero(state.angvel))
        .setSoftCcdPrediction(softCcdPrediction)
        .setCcdEnabled(true);
    if (lockRotation) bodyDescription.lockRotations();
    const body = this.world.createRigidBody(bodyDescription);
    const createdCollider = this.world.createCollider(collider, body);
    this.bodies.set(key, body);
    this.colliders.set(key, createdCollider);
    this.colliderKeys.set(createdCollider.handle, key);
  }

  private meshStatics(geometry: PhysicsWorldGeometry): number {
    const visited = new Uint8Array(geometry.width * geometry.height);
    let count = 0;
    for (let row = 0; row < geometry.height; row++) {
      for (let column = 0; column < geometry.width; column++) {
        const start = row * geometry.width + column;
        if (visited[start] || geometry.collisions[start] === 0) continue;
        let width = 1;
        while (
          column + width < geometry.width &&
          !visited[start + width] &&
          geometry.collisions[start + width] !== 0
        ) width++;
        let height = 1;
        outer: while (row + height < geometry.height) {
          for (let offset = 0; offset < width; offset++) {
            const index = (row + height) * geometry.width + column + offset;
            if (visited[index] || geometry.collisions[index] === 0) break outer;
          }
          height++;
        }
        for (let y = 0; y < height; y++) {
          visited.fill(1, (row + y) * geometry.width + column, (row + y) * geometry.width + column + width);
        }
        const halfWidth = width * geometry.tileWidth / 2;
        const halfHeight = height * geometry.tileHeight / 2;
        this.createStatic(
          column * geometry.tileWidth + halfWidth,
          row * geometry.tileHeight + halfHeight,
          halfWidth,
          halfHeight
        );
        count++;
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

function groups(membership: number, filter: number): number {
  return (membership << 16) | filter;
}

function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? value : 0;
}
