import type {PhysicsBodyState, PhysicsWorld} from '../../../shared/physics/physics-world.ts';

export type PhysicsActorType = 'vehicle' | 'player' | 'pedestrian' | 'prop';
export type PhysicsBodyControl = 'authored' | 'simulated';

export interface PhysicsActorDescriptor {
  key: string;
  actorType: PhysicsActorType;
  entityId: string;
  surfaceId: string;
  shapeKey: string;
  state: PhysicsBodyState;
  control?: PhysicsBodyControl;
}

export interface PhysicsLifecycleOperations {
  created: number;
  removed: number;
  migrated: number;
  replaced: number;
  teleported: number;
}

export interface PhysicsBodySnapshot extends PhysicsBodyState {
  key: string;
  actorType: PhysicsActorType;
  entityId: string;
  surfaceId: string;
  shapeKey: string;
  shapeRevision: number;
  lifecycleRevision: number;
}

interface PhysicsBodyRecord {
  actorType: PhysicsActorType;
  entityId: string;
  surfaceId: string;
  shapeKey: string;
  shapeRevision: number;
  lifecycleRevision: number;
  world: PhysicsWorld;
}

interface PhysicsBodyRevision {
  shapeKey: string;
  shapeRevision: number;
  lifecycleRevision: number;
}

const ACTOR_ORDER: Readonly<Record<PhysicsActorType, number>> = Object.freeze({
  vehicle: 0,
  player: 1,
  pedestrian: 2,
  prop: 3
});

export class PhysicsBodyRegistry {
  private readonly records = new Map<string, PhysicsBodyRecord>();
  private readonly revisions = new Map<string, PhysicsBodyRevision>();
  private current = emptyOperations();
  private total = emptyOperations();

  constructor(private readonly worldForSurface: (surfaceId: string) => PhysicsWorld) {}

  get bodyCount(): number {
    return this.records.size;
  }

  has(key: string): boolean {
    return this.records.has(key);
  }

  reconcile(input: readonly PhysicsActorDescriptor[]): PhysicsLifecycleOperations {
    this.current = emptyOperations();
    const descriptors = [...input].sort(compareDescriptors);
    const expected = new Map<string, PhysicsActorDescriptor>();
    for (const descriptor of descriptors) {
      if (expected.has(descriptor.key)) {
        throw new Error(`Duplicate physics actor key "${descriptor.key}".`);
      }
      expected.set(descriptor.key, descriptor);
    }

    for (const key of [...this.records.keys()].sort()) {
      if (expected.has(key)) continue;
      this.removeRecord(key);
      this.increment('removed');
    }

    const transitioned = new Set<string>();
    for (const descriptor of descriptors) {
      const record = this.records.get(descriptor.key);
      if (!record || record.surfaceId === descriptor.surfaceId) continue;
      this.replaceRecord(descriptor);
      transitioned.add(descriptor.key);
      this.increment('migrated');
    }

    for (const descriptor of descriptors) {
      const record = this.records.get(descriptor.key);
      if (!record || transitioned.has(descriptor.key) || record.shapeKey === descriptor.shapeKey) {
        continue;
      }
      this.replaceRecord(descriptor);
      transitioned.add(descriptor.key);
      this.increment('replaced');
    }

    for (const descriptor of descriptors) {
      if (this.records.has(descriptor.key)) continue;
      this.createRecord(descriptor);
      transitioned.add(descriptor.key);
      this.increment('created');
    }

    for (const descriptor of descriptors) {
      if (transitioned.has(descriptor.key)) continue;
      const record = this.records.get(descriptor.key);
      if (!record) continue;
      if (record.world.shouldTeleport(descriptor.key, descriptor.state, 0.001)) {
        record.world.teleport(descriptor.key, descriptor.state);
        this.increment('teleported');
      } else if ((descriptor.control ?? 'authored') === 'authored') {
        record.world.synchronizeVelocity(descriptor.key, descriptor.state);
      }
    }
    return this.tickOperations();
  }

  tickOperations(): PhysicsLifecycleOperations {
    return {...this.current};
  }

  cumulativeOperations(): PhysicsLifecycleOperations {
    return {...this.total};
  }

  bodyIdentity(key: string): number | undefined {
    const record = this.records.get(key);
    return record?.world.bodyIdentity(key);
  }

  snapshots(): readonly PhysicsBodySnapshot[] {
    return Object.freeze([...this.records.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, record]) => {
        const state = record.world.capture(key);
        if (!state) throw new Error(`Physics body "${key}" disappeared during snapshot capture.`);
        return Object.freeze({
          key,
          actorType: record.actorType,
          entityId: record.entityId,
          surfaceId: record.surfaceId,
          shapeKey: record.shapeKey,
          shapeRevision: record.shapeRevision,
          lifecycleRevision: record.lifecycleRevision,
          ...state
        });
      }));
  }

  clear(): void {
    for (const key of [...this.records.keys()].sort()) this.removeRecord(key);
    this.current = emptyOperations();
  }

  private replaceRecord(descriptor: PhysicsActorDescriptor): void {
    this.removeRecord(descriptor.key);
    this.createRecord(descriptor);
  }

  private createRecord(descriptor: PhysicsActorDescriptor): void {
    const world = this.worldForSurface(descriptor.surfaceId);
    if (descriptor.actorType === 'vehicle') {
      world.registerVehicle(descriptor.key, vehicleKind(descriptor.shapeKey), descriptor.state);
    } else if (descriptor.actorType === 'prop') {
      world.registerSoccerBall(descriptor.key, soccerBallRadius(descriptor.shapeKey), descriptor.state);
    } else {
      world.registerHumanoid(descriptor.key, humanoidRadius(descriptor.shapeKey), descriptor.state);
    }
    const previous = this.revisions.get(descriptor.key);
    const revision = Object.freeze({
      shapeKey: descriptor.shapeKey,
      shapeRevision: previous
        ? previous.shapeRevision + Number(previous.shapeKey !== descriptor.shapeKey)
        : 1,
      lifecycleRevision: previous ? previous.lifecycleRevision + 1 : 1
    });
    this.revisions.set(descriptor.key, revision);
    this.records.set(descriptor.key, {
      actorType: descriptor.actorType,
      entityId: descriptor.entityId,
      surfaceId: descriptor.surfaceId,
      shapeKey: descriptor.shapeKey,
      shapeRevision: revision.shapeRevision,
      lifecycleRevision: revision.lifecycleRevision,
      world
    });
  }

  private removeRecord(key: string): void {
    const record = this.records.get(key);
    if (!record) return;
    record.world.remove(key);
    this.records.delete(key);
  }

  private increment(key: keyof PhysicsLifecycleOperations): void {
    this.current[key]++;
    this.total[key]++;
  }
}

function compareDescriptors(left: PhysicsActorDescriptor, right: PhysicsActorDescriptor): number {
  return left.surfaceId.localeCompare(right.surfaceId) ||
    ACTOR_ORDER[left.actorType] - ACTOR_ORDER[right.actorType] ||
    left.entityId.localeCompare(right.entityId) ||
    left.key.localeCompare(right.key);
}

function vehicleKind(shapeKey: string): string {
  if (!shapeKey.startsWith('vehicle:')) throw new Error(`Invalid vehicle shape key: ${shapeKey}`);
  return shapeKey.slice('vehicle:'.length);
}

function humanoidRadius(shapeKey: string): number {
  if (!shapeKey.startsWith('humanoid:')) throw new Error(`Invalid humanoid shape key: ${shapeKey}`);
  const radius = Number(shapeKey.slice('humanoid:'.length));
  if (!Number.isFinite(radius) || radius <= 0) {
    throw new Error(`Invalid humanoid radius in shape key: ${shapeKey}`);
  }
  return radius;
}

function soccerBallRadius(shapeKey: string): number {
  if (!shapeKey.startsWith('soccer-ball:')) {
    throw new Error(`Invalid soccer ball shape key: ${shapeKey}`);
  }
  const radius = Number(shapeKey.slice('soccer-ball:'.length));
  if (!Number.isFinite(radius) || radius <= 0) {
    throw new Error(`Invalid soccer ball radius in shape key: ${shapeKey}`);
  }
  return radius;
}

function emptyOperations(): PhysicsLifecycleOperations {
  return {created: 0, removed: 0, migrated: 0, replaced: 0, teleported: 0};
}
