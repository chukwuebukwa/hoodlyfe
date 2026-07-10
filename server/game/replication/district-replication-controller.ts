import {Schema, StateView} from '@colyseus/schema';
import {STREET_SPACE_ID} from '../../../shared/content/interior-catalog.ts';
import type {DistrictState} from '../../state.ts';

interface ClientProjection {
  view: StateView;
  visible: Set<Schema>;
}

export class DistrictReplicationController {
  private readonly clients = new Map<string, ClientProjection>();

  constructor(private readonly state: DistrictState) {}

  attach(playerId: string): StateView {
    const existing = this.clients.get(playerId);
    if (existing) return existing.view;
    const projection = {view: new StateView(), visible: new Set<Schema>()};
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

  private synchronizeClient(playerId: string, projection: ClientProjection): void {
    const player = this.state.players.get(playerId);
    const desired = new Set<Schema>();
    if (player) {
      const spaceId = player.spaceId || STREET_SPACE_ID;
      for (const candidate of this.state.players.values()) {
        if ((candidate.spaceId || STREET_SPACE_ID) === spaceId) desired.add(candidate);
      }
      for (const service of this.state.services.values()) {
        if ((service.spaceId || STREET_SPACE_ID) === spaceId) desired.add(service);
      }
      if (spaceId === STREET_SPACE_ID) this.addStreetState(desired);
    }

    for (const visible of projection.visible) {
      if (desired.has(visible)) continue;
      projection.view.remove(visible);
      projection.visible.delete(visible);
    }
    for (const candidate of desired) {
      if (projection.visible.has(candidate)) continue;
      projection.view.add(candidate);
      projection.visible.add(candidate);
    }
  }

  private addStreetState(desired: Set<Schema>): void {
    for (const collection of [
      this.state.bullets,
      this.state.thrownProjectiles,
      this.state.explosions,
      this.state.weaponPickups,
      this.state.trafficSignals,
      this.state.npcs,
      this.state.vehicles,
      this.state.missions
    ]) {
      for (const value of collection.values()) desired.add(value);
    }
  }
}
