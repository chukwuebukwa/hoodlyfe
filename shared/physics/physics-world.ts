// Determinism contract: register bodies in deterministic order, drive with
// deterministic velocities, step at the fixed timestep. Two worlds built from the
// same geometry then produce bit-identical states.

import RAPIER from '@dimforge/rapier2d-compat';
import {
  SOCCER_BALL_ANGULAR_DAMPING,
  SOCCER_BALL_FRICTION,
  SOCCER_BALL_LINEAR_DAMPING,
  SOCCER_BALL_MASS,
  SOCCER_BALL_RESTITUTION
} from '../content/soccer-ball.ts';
import {vehicleDefinition} from '../content/vehicle-catalog.ts';
import {SIMULATION_STEP_SECONDS} from '../simulation/timing.ts';

export const PHYSICS_TIMESTEP_SECONDS = SIMULATION_STEP_SECONDS;
const VEHICLE_RESTITUTION = 0.2;
const VEHICLE_FRICTION = 0.6;
const HUMANOID_DENSITY = 0.4;
const STATIC_MEMBERSHIP = 0x0001;
const VEHICLE_MEMBERSHIP = 0x0002;
const HUMANOID_MEMBERSHIP = 0x0004;
const PROP_MEMBERSHIP = 0x0008;

interface DynamicBodyOptions {
  lockRotation?: boolean;
  softCcdPrediction?: number;
  linearDamping?: number;
  angularDamping?: number;
}

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
  readonly originX?: number;
  readonly originY?: number;
  readonly encloseBorders?: boolean;
  readonly collisions: readonly number[];
  readonly barriers?: readonly Readonly<{
    from: Readonly<{x: number; y: number}>;
    to: Readonly<{x: number; y: number}>;
    thickness?: number;
  }>[];
  readonly staticRects?: readonly PhysicsStaticRect[];
  readonly collisionExclusions?: readonly PhysicsStaticRect[];
  readonly controlledStaticRects?: readonly PhysicsControlledStaticRect[];
}

export interface PhysicsStaticRect {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

export interface PhysicsControlledStaticRect extends PhysicsStaticRect {
  readonly id: string;
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
  private readonly staticColliders: RAPIER.Collider[] = [];
  private readonly controlledStaticColliders = new Map<string, RAPIER.Collider>();
  private readonly children = new Set<PhysicsWorld>();
  private freed = false;

  private constructor(
    private readonly geometry: PhysicsWorldGeometry,
    includeStatics = true
  ) {
    this.world = new RAPIER.World({x: 0, y: 0});
    this.world.timestep = PHYSICS_TIMESTEP_SECONDS;
    this.world.numSolverIterations = 8;
    this.world.maxCcdSubsteps = 4;
    this.staticColliderCount = includeStatics
      ? this.meshStatics(geometry) +
        this.meshBarrierSegments(geometry) +
        this.meshStaticRects(geometry) +
        this.meshControlledStaticRects(geometry) +
        (geometry.encloseBorders === false ? 0 : this.buildBorderWalls(geometry))
      : 0;
  }

  static create(geometry: PhysicsWorldGeometry): PhysicsWorld {
    if (!engineReady) {
      throw new Error('initializePhysicsEngine() must resolve before creating a world.');
    }
    return new PhysicsWorld(geometry);
  }

  fork(includeStatics = false, geometry = this.geometry): PhysicsWorld {
    if (this.freed) throw new Error('Cannot fork a freed physics world.');
    const child = new PhysicsWorld(geometry, includeStatics);
    this.children.add(child);
    return child;
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
          STATIC_MEMBERSHIP | VEHICLE_MEMBERSHIP | HUMANOID_MEMBERSHIP | PROP_MEMBERSHIP
        )),
      {}
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
          STATIC_MEMBERSHIP | VEHICLE_MEMBERSHIP | PROP_MEMBERSHIP
        )),
      {softCcdPrediction: radius}
    );
  }

  registerSoccerBall(key: string, radius: number, state: PhysicsBodyState): void {
    this.register(
      key,
      state,
      RAPIER.ColliderDesc.ball(radius)
        .setMass(SOCCER_BALL_MASS)
        .setRestitution(SOCCER_BALL_RESTITUTION)
        .setFriction(SOCCER_BALL_FRICTION)
        .setCollisionGroups(groups(
          PROP_MEMBERSHIP,
          STATIC_MEMBERSHIP | VEHICLE_MEMBERSHIP | HUMANOID_MEMBERSHIP | PROP_MEMBERSHIP
        )),
      {
        softCcdPrediction: radius,
        linearDamping: SOCCER_BALL_LINEAR_DAMPING,
        angularDamping: SOCCER_BALL_ANGULAR_DAMPING
      }
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

  get bodyCount(): number {
    return this.bodies.size;
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

  applyImpulse(key: string, impulseX: number, impulseY: number): void {
    const body = this.bodies.get(key);
    if (!body) return;
    body.applyImpulse({x: finiteOrZero(impulseX), y: finiteOrZero(impulseY)}, true);
  }

  shouldTeleport(key: string, state: PhysicsBodyState, teleportTolerance = 0.001): boolean {
    const body = this.bodies.get(key);
    if (!body) return false;
    const translation = body.translation();
    return Math.hypot(
      translation.x - finiteOrZero(state.x),
      translation.y - finiteOrZero(state.y)
    ) > Math.max(0, teleportTolerance);
  }

  synchronizeVelocity(key: string, state: PhysicsBodyState): void {
    const body = this.bodies.get(key);
    if (!body) return;
    body.setRotation(finiteOrZero(state.rotation), true);
    body.setLinvel({x: finiteOrZero(state.linvelX), y: finiteOrZero(state.linvelY)}, true);
    body.setAngvel(finiteOrZero(state.angvel), true);
  }

  teleport(key: string, state: PhysicsBodyState): void {
    const body = this.bodies.get(key);
    if (!body) return;
    body.setTranslation({x: finiteOrZero(state.x), y: finiteOrZero(state.y)}, true);
    body.setRotation(finiteOrZero(state.rotation), true);
    body.setLinvel({x: finiteOrZero(state.linvelX), y: finiteOrZero(state.linvelY)}, true);
    body.setAngvel(finiteOrZero(state.angvel), true);
  }

  bodyIdentity(key: string): number | undefined {
    return this.bodies.get(key)?.handle;
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

  setStaticsEnabled(enabled: boolean): void {
    const collisionGroups = enabled ? groups(STATIC_MEMBERSHIP, 0xffff) : 0;
    for (const collider of this.staticColliders) collider.setCollisionGroups(collisionGroups);
  }

  setControlledStaticEnabled(id: string, enabled: boolean): void {
    const collider = this.controlledStaticColliders.get(id);
    if (!collider) return;
    collider.setCollisionGroups(enabled ? groups(STATIC_MEMBERSHIP, 0xffff) : 0);
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
    for (const child of this.children) child.free();
    this.children.clear();
    this.bodies.clear();
    this.colliders.clear();
    this.colliderKeys.clear();
    this.staticColliders.length = 0;
    this.controlledStaticColliders.clear();
    this.world.free();
  }

  private register(
    key: string,
    state: PhysicsBodyState,
    collider: RAPIER.ColliderDesc,
    options: DynamicBodyOptions = {}
  ): void {
    if (this.bodies.has(key)) {
      throw new Error(`Physics body already registered for key "${key}".`);
    }
    const bodyDescription = RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(finiteOrZero(state.x), finiteOrZero(state.y))
        .setRotation(finiteOrZero(state.rotation))
        .setLinvel(finiteOrZero(state.linvelX), finiteOrZero(state.linvelY))
        .setAngvel(finiteOrZero(state.angvel))
        .setSoftCcdPrediction(options.softCcdPrediction ?? 0)
        .setLinearDamping(options.linearDamping ?? 0)
        .setAngularDamping(options.angularDamping ?? 0)
        .setCcdEnabled(true);
    if (options.lockRotation) bodyDescription.lockRotations();
    const body = this.world.createRigidBody(bodyDescription);
    const createdCollider = this.world.createCollider(collider, body);
    this.bodies.set(key, body);
    this.colliders.set(key, createdCollider);
    this.colliderKeys.set(createdCollider.handle, key);
  }

  private meshStatics(geometry: PhysicsWorldGeometry): number {
    const originX = geometry.originX ?? 0;
    const originY = geometry.originY ?? 0;
    const visited = new Uint8Array(geometry.width * geometry.height);
    let count = 0;
    for (let row = 0; row < geometry.height; row++) {
      for (let column = 0; column < geometry.width; column++) {
        const start = row * geometry.width + column;
        if (visited[start] || !hasStaticCell(geometry, column, row)) continue;
        let width = 1;
        while (
          column + width < geometry.width &&
          !visited[start + width] &&
          hasStaticCell(geometry, column + width, row)
        ) width++;
        let height = 1;
        outer: while (row + height < geometry.height) {
          for (let offset = 0; offset < width; offset++) {
            const index = (row + height) * geometry.width + column + offset;
            if (visited[index] || !hasStaticCell(geometry, column + offset, row + height)) {
              break outer;
            }
          }
          height++;
        }
        for (let y = 0; y < height; y++) {
          visited.fill(1, (row + y) * geometry.width + column, (row + y) * geometry.width + column + width);
        }
        const halfWidth = width * geometry.tileWidth / 2;
        const halfHeight = height * geometry.tileHeight / 2;
        this.createStatic(
          originX + column * geometry.tileWidth + halfWidth,
          originY + row * geometry.tileHeight + halfHeight,
          halfWidth,
          halfHeight
        );
        count++;
      }
    }
    return count;
  }

  private meshBarrierSegments(geometry: PhysicsWorldGeometry): number {
    let count = 0;
    for (const barrier of geometry.barriers ?? []) {
      const deltaX = barrier.to.x - barrier.from.x;
      const deltaY = barrier.to.y - barrier.from.y;
      const length = Math.hypot(deltaX, deltaY);
      if (!Number.isFinite(length) || length <= 0) continue;
      this.createStatic(
        (barrier.from.x + barrier.to.x) / 2,
        (barrier.from.y + barrier.to.y) / 2,
        length / 2,
        barrier.thickness ?? 3,
        Math.atan2(deltaY, deltaX)
      );
      count++;
    }
    return count;
  }

  private meshStaticRects(geometry: PhysicsWorldGeometry): number {
    const rectangles = [...(geometry.staticRects ?? [])].sort((left, right) => (
      left.minY - right.minY || left.minX - right.minX ||
      left.maxY - right.maxY || left.maxX - right.maxX
    ));
    for (const rect of rectangles) {
      const halfWidth = (rect.maxX - rect.minX) / 2;
      const halfHeight = (rect.maxY - rect.minY) / 2;
      if (halfWidth <= 0 || halfHeight <= 0) {
        throw new Error('Physics static rectangles must have positive dimensions.');
      }
      this.createStatic(
        rect.minX + halfWidth,
        rect.minY + halfHeight,
        halfWidth,
        halfHeight
      );
    }
    return rectangles.length;
  }

  private meshControlledStaticRects(geometry: PhysicsWorldGeometry): number {
    const rectangles = [...(geometry.controlledStaticRects ?? [])].sort((left, right) => (
      left.id.localeCompare(right.id)
    ));
    for (const rect of rectangles) {
      const halfWidth = (rect.maxX - rect.minX) / 2;
      const halfHeight = (rect.maxY - rect.minY) / 2;
      if (halfWidth <= 0 || halfHeight <= 0) {
        throw new Error('Physics controlled static rectangles must have positive dimensions.');
      }
      const collider = this.createStatic(
        rect.minX + halfWidth,
        rect.minY + halfHeight,
        halfWidth,
        halfHeight
      );
      this.controlledStaticColliders.set(rect.id, collider);
    }
    return rectangles.length;
  }

  // Tile data leaves border cells open; only CollisionMap's code blocks out-of-bounds,
  // so the physical world needs explicit walls.
  private buildBorderWalls(geometry: PhysicsWorldGeometry): number {
    const originX = geometry.originX ?? 0;
    const originY = geometry.originY ?? 0;
    const worldWidth = geometry.width * geometry.tileWidth;
    const worldHeight = geometry.height * geometry.tileHeight;
    const tile = Math.max(geometry.tileWidth, geometry.tileHeight);
    const walls = [
      {
        x: originX + worldWidth / 2,
        y: originY - tile / 2,
        hx: worldWidth / 2 + tile,
        hy: tile / 2
      },
      {
        x: originX + worldWidth / 2,
        y: originY + worldHeight + tile / 2,
        hx: worldWidth / 2 + tile,
        hy: tile / 2
      },
      {
        x: originX - tile / 2,
        y: originY + worldHeight / 2,
        hx: tile / 2,
        hy: worldHeight / 2 + tile
      },
      {
        x: originX + worldWidth + tile / 2,
        y: originY + worldHeight / 2,
        hx: tile / 2,
        hy: worldHeight / 2 + tile
      }
    ];
    for (const wall of walls) this.createStatic(wall.x, wall.y, wall.hx, wall.hy);
    return walls.length;
  }

  private createStatic(
    x: number,
    y: number,
    halfWidth: number,
    halfHeight: number,
    rotation = 0
  ): RAPIER.Collider {
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(x, y).setRotation(rotation)
    );
    const collider = this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(halfWidth, halfHeight)
        .setCollisionGroups(groups(STATIC_MEMBERSHIP, 0xffff)),
      body
    );
    this.staticColliders.push(collider);
    return collider;
  }
}

function groups(membership: number, filter: number): number {
  return (membership << 16) | filter;
}

function hasStaticCell(
  geometry: PhysicsWorldGeometry,
  column: number,
  row: number
): boolean {
  if (geometry.collisions[row * geometry.width + column] === 0) return false;
  const x = (geometry.originX ?? 0) + (column + 0.5) * geometry.tileWidth;
  const y = (geometry.originY ?? 0) + (row + 0.5) * geometry.tileHeight;
  return !(geometry.collisionExclusions ?? []).some((rect) => (
    x >= rect.minX && x <= rect.maxX && y >= rect.minY && y <= rect.maxY
  ));
}

function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? value : 0;
}
