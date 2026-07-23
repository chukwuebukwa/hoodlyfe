import type {Client} from '@colyseus/core';
import {
  PROJECTILE_IMPACTS_MESSAGE,
  type ProjectileImpactPayload,
  type ProjectileImpactsMessage
} from '../../../shared/protocol/projectile-impacts.ts';
import {STREET_SPACE_ID} from '../../../shared/content/interior-catalog.ts';
import type {DistrictState, PlayerState} from '../../state.ts';
import type {GameEvent} from './game-events.ts';

const VISIBLE_RADIUS = 1_280;
const MAX_IMPACTS_PER_CLIENT = 48;

interface ProjectileImpactPublisherOptions {
  state: DistrictState;
  clients: () => Iterable<Client>;
}

export class ProjectileImpactPublisher {
  constructor(private readonly options: ProjectileImpactPublisherOptions) {}

  publish(events: readonly GameEvent[]): void {
    const impacts = events.flatMap((event, index): ProjectileImpactPayload[] => (
      event.type === 'projectile.impact'
        ? [{
            id: `${event.tick}:${index}:${event.projectileId}`,
            tick: event.tick,
            weapon: event.weapon,
            targetKind: event.targetKind,
            targetId: event.targetId,
            x: event.x,
            y: event.y,
            angle: event.angle,
            surfaceId: event.surfaceId
          }]
        : []
    ));
    if (impacts.length === 0) return;

    for (const client of this.options.clients()) {
      const listener = this.listener(client.sessionId);
      if (!listener) continue;
      const nearby = impacts
        .filter((impact) => impact.surfaceId === listener.surfaceId)
        .map((impact) => ({
          impact,
          distance: Math.hypot(impact.x - listener.x, impact.y - listener.y)
        }))
        .filter(({distance}) => distance <= VISIBLE_RADIUS)
        .sort((left, right) => left.distance - right.distance || left.impact.id.localeCompare(right.impact.id))
        .slice(0, MAX_IMPACTS_PER_CLIENT)
        .map(({impact}) => impact);
      if (nearby.length === 0) continue;
      client.send(PROJECTILE_IMPACTS_MESSAGE, {
        tick: nearby[nearby.length - 1].tick,
        impacts: nearby
      } satisfies ProjectileImpactsMessage);
    }
  }

  private listener(playerId: string): PlayerState | undefined {
    const player = this.options.state.players.get(playerId);
    return player?.spaceId === STREET_SPACE_ID ? player : undefined;
  }
}
