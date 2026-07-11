import {Schema, StateView} from '@colyseus/schema';
import {STREET_SPACE_ID} from '../../../shared/content/interior-catalog.ts';
import type {DistrictState} from '../../state.ts';
import {
  compareReplicationCandidate,
  shouldReplicateStreetEntity,
  STREET_STREAMING
} from './street-streaming-policy.ts';

export type ReplicatedStreetActorKind = 'npc' | 'vehicle';

export interface ReplicatedStreetActor {
  id: string;
  kind: ReplicatedStreetActorKind;
  x: number;
  y: number;
  schema: Schema;
}

interface DistrictReplicationControllerOptions {
  queryStreetActors?: (x: number, y: number, radius: number) => ReplicatedStreetActor[];
  maxAddsPerPatch?: number;
  maxRemovesPerPatch?: number;
}

export interface DistrictReplicationDiagnostic {
  playerId: string;
  spaceId: string;
  visible: number;
  nearbyActors: number;
  pendingAdds: number;
  pendingRemoves: number;
}

interface ClientProjection {
  view: StateView;
  visible: Set<Schema>;
  awaitingCompleteSnapshot: Set<Schema>;
  diagnostic: DistrictReplicationDiagnostic;
}

interface DesiredSchema {
  schema: Schema;
  priority: number;
  distance: number;
  key: string;
}

export class DistrictReplicationController {
  private readonly clients = new Map<string, ClientProjection>();
  private readonly maxAddsPerPatch: number;
  private readonly maxRemovesPerPatch: number;

  constructor(
    private readonly state: DistrictState,
    private readonly options: DistrictReplicationControllerOptions = {}
  ) {
    this.maxAddsPerPatch = positiveInteger(
      options.maxAddsPerPatch ?? STREET_STREAMING.maxAddsPerPatch,
      'Replication add budget'
    );
    this.maxRemovesPerPatch = positiveInteger(
      options.maxRemovesPerPatch ?? STREET_STREAMING.maxRemovesPerPatch,
      'Replication remove budget'
    );
  }

  attach(playerId: string): StateView {
    const existing = this.clients.get(playerId);
    if (existing) return existing.view;
    const projection = {
      view: new StateView(),
      visible: new Set<Schema>(),
      awaitingCompleteSnapshot: new Set<Schema>(),
      diagnostic: {
        playerId,
        spaceId: '',
        visible: 0,
        nearbyActors: 0,
        pendingAdds: 0,
        pendingRemoves: 0
      }
    };
    this.clients.set(playerId, projection);
    this.synchronizeClient(playerId, projection);
    return projection.view;
  }

  detach(playerId: string): void {
    this.clients.delete(playerId);
  }

  synchronize(): void {
    for (const [playerId, projection] of this.clients) {
      this.synchronizeClient(playerId, projection);
    }
  }

  diagnostics(): DistrictReplicationDiagnostic[] {
    return [...this.clients.values()]
      .map((projection) => ({...projection.diagnostic}))
      .sort((left, right) => left.playerId.localeCompare(right.playerId));
  }

  private synchronizeClient(playerId: string, projection: ClientProjection): void {
    const player = this.state.players.get(playerId);
    const desired = new Map<Schema, DesiredSchema>();
    let nearbyActors = 0;
    let spaceId = '';
    if (player) {
      spaceId = player.spaceId || STREET_SPACE_ID;
      for (const candidate of this.state.players.values()) {
        if ((candidate.spaceId || STREET_SPACE_ID) === spaceId) {
          this.addDesired(desired, candidate, 0, 0, `player:${candidate.id}`);
        }
      }
      for (const service of this.state.services.values()) {
        if ((service.spaceId || STREET_SPACE_ID) === spaceId) {
          this.addDesired(desired, service, 1, 0, `service:${service.id}`);
        }
      }
      if (spaceId === STREET_SPACE_ID) {
        nearbyActors = this.addStreetState(playerId, player.x, player.y, projection, desired);
      }
    }

    const removals = [...projection.visible]
      .filter((visible) => !desired.has(visible))
      .slice(0, this.maxRemovesPerPatch);
    for (const visible of removals) {
      projection.view.remove(visible);
      projection.visible.delete(visible);
      projection.awaitingCompleteSnapshot.delete(visible);
    }

    const additions = [...desired.values()]
      .filter((candidate) => !projection.visible.has(candidate.schema))
      .sort(compareReplicationCandidate)
      .slice(0, this.maxAddsPerPatch);
    for (const candidate of additions) {
      const completeSnapshotQueued = projection.view.add(candidate.schema);
      projection.visible.add(candidate.schema);
      if (!completeSnapshotQueued) projection.awaitingCompleteSnapshot.add(candidate.schema);
    }
    for (const candidate of desired.values()) {
      if (!projection.visible.has(candidate.schema)) continue;
      if (!projection.awaitingCompleteSnapshot.has(candidate.schema)) continue;
      if (projection.view.add(candidate.schema)) {
        projection.awaitingCompleteSnapshot.delete(candidate.schema);
      }
    }

    projection.diagnostic = {
      playerId,
      spaceId,
      visible: projection.visible.size,
      nearbyActors,
      pendingAdds: Math.max(0, desired.size - projection.visible.size),
      pendingRemoves: Math.max(0, projection.visible.size - desired.size)
    };
  }

  private addStreetState(
    playerId: string,
    x: number,
    y: number,
    projection: ClientProjection,
    desired: Map<Schema, DesiredSchema>
  ): number {
    for (const pickup of this.state.weaponPickups.values()) {
      this.addDesired(desired, pickup, 2, distance(x, y, pickup.x, pickup.y), `pickup:${pickup.id}`);
    }
    for (const pickup of this.state.cashPickups.values()) {
      const pickupDistance = distance(x, y, pickup.x, pickup.y);
      if (!shouldReplicateStreetEntity({
        distance: pickupDistance,
        visible: projection.visible.has(pickup),
        alwaysRelevant: false
      })) continue;
      this.addDesired(desired, pickup, 2, pickupDistance, `cash:${pickup.id}`);
    }
    for (const signal of this.state.trafficSignals.values()) {
      this.addDesired(desired, signal, 2, distance(x, y, signal.x, signal.y), `signal:${signal.id}`);
    }
    for (const mission of this.state.missions.values()) {
      this.addDesired(desired, mission, 1, 0, `mission:${mission.id}`);
      if (!mission.participants.has(playerId)) continue;
      const target = this.state.vehicles.get(mission.targetVehicleId);
      if (target) this.addDesired(desired, target, 0, 0, `vehicle:${target.id}`);
      const targetNpc = this.state.npcs.get(mission.targetNpcId);
      if (targetNpc) this.addDesired(desired, targetNpc, 0, 0, `npc:${targetNpc.id}`);
    }
    for (const vehicle of this.state.vehicles.values()) {
      if (!this.isOccupiedByPlayer(vehicle.id)) continue;
      this.addDesired(desired, vehicle, 0, 0, `vehicle:${vehicle.id}`);
    }

    const actors = this.queryStreetActors(x, y, STREET_STREAMING.exitRadius);
    for (const actor of actors) {
      const actorDistance = distance(x, y, actor.x, actor.y);
      const alwaysRelevant = actor.kind === 'vehicle' && this.isOccupiedByPlayer(actor.id);
      if (!shouldReplicateStreetEntity({
        distance: actorDistance,
        visible: projection.visible.has(actor.schema),
        alwaysRelevant
      })) continue;
      this.addDesired(
        desired,
        actor.schema,
        alwaysRelevant ? 0 : 3,
        actorDistance,
        `${actor.kind}:${actor.id}`
      );
    }

    for (const bullet of this.state.bullets.values()) {
      this.addTransientIfRelevant(
        desired,
        projection,
        bullet,
        x,
        y,
        bullet.ownerId === playerId,
        `bullet:${bullet.id}`
      );
    }
    for (const projectile of this.state.thrownProjectiles.values()) {
      this.addTransientIfRelevant(
        desired,
        projection,
        projectile,
        x,
        y,
        projectile.ownerId === playerId,
        `thrown:${projectile.id}`
      );
    }
    for (const explosion of this.state.explosions.values()) {
      this.addTransientIfRelevant(
        desired,
        projection,
        explosion,
        x,
        y,
        explosion.sourceId === playerId,
        `explosion:${explosion.id}`
      );
    }
    return actors.length;
  }

  private addTransientIfRelevant(
    desired: Map<Schema, DesiredSchema>,
    projection: ClientProjection,
    schema: Schema & {x: number; y: number},
    x: number,
    y: number,
    alwaysRelevant: boolean,
    key: string
  ): void {
    const entityDistance = distance(x, y, schema.x, schema.y);
    if (!shouldReplicateStreetEntity({
      distance: entityDistance,
      visible: projection.visible.has(schema),
      alwaysRelevant
    })) return;
    this.addDesired(desired, schema, alwaysRelevant ? 0 : 4, entityDistance, key);
  }

  private queryStreetActors(x: number, y: number, radius: number): ReplicatedStreetActor[] {
    if (this.options.queryStreetActors) return this.options.queryStreetActors(x, y, radius);
    const actors: ReplicatedStreetActor[] = [];
    for (const npc of this.state.npcs.values()) {
      if (distance(x, y, npc.x, npc.y) <= radius) {
        actors.push({id: npc.id, kind: 'npc', x: npc.x, y: npc.y, schema: npc});
      }
    }
    for (const vehicle of this.state.vehicles.values()) {
      if (distance(x, y, vehicle.x, vehicle.y) <= radius) {
        actors.push({id: vehicle.id, kind: 'vehicle', x: vehicle.x, y: vehicle.y, schema: vehicle});
      }
    }
    return actors.sort((left, right) => (
      left.kind.localeCompare(right.kind) || left.id.localeCompare(right.id)
    ));
  }

  private isOccupiedByPlayer(vehicleId: string): boolean {
    const vehicle = this.state.vehicles.get(vehicleId);
    if (!vehicle) return false;
    if (vehicle.driverId && this.state.players.has(vehicle.driverId)) return true;
    for (const player of this.state.players.values()) {
      if (player.vehicleId === vehicleId) return true;
    }
    return false;
  }

  private addDesired(
    desired: Map<Schema, DesiredSchema>,
    schema: Schema,
    priority: number,
    schemaDistance: number,
    key: string
  ): void {
    const existing = desired.get(schema);
    if (existing && compareReplicationCandidate(existing, {priority, distance: schemaDistance, key}) <= 0) {
      return;
    }
    desired.set(schema, {schema, priority, distance: schemaDistance, key});
  }
}

function distance(x: number, y: number, targetX: number, targetY: number): number {
  return Math.hypot(targetX - x, targetY - y);
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive integer.`);
  }
  return value;
}
