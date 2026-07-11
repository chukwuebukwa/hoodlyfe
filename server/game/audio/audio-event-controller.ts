import type {Client} from '@colyseus/core';
import {
  AUDIO_EVENTS_MESSAGE,
  type AudioEventPayload,
  type AudioEventsMessage
} from '../../../shared/protocol/audio-events.ts';
import type {DistrictState, PlayerState} from '../../state.ts';
import type {GameEvent} from '../events/game-events.ts';

interface AudioEventControllerOptions {
  state: DistrictState;
  clients: () => Iterable<Client>;
  audibleRadius?: number;
  maxEventsPerClient?: number;
}

const DEFAULT_AUDIBLE_RADIUS = 1_150;
const DEFAULT_MAX_EVENTS = 24;

export class AudioEventController {
  private readonly audibleRadius: number;
  private readonly maxEventsPerClient: number;

  constructor(private readonly options: AudioEventControllerOptions) {
    this.audibleRadius = positive(options.audibleRadius ?? DEFAULT_AUDIBLE_RADIUS, 'Audible radius');
    this.maxEventsPerClient = positive(options.maxEventsPerClient ?? DEFAULT_MAX_EVENTS, 'Max audio events');
  }

  publish(events: readonly GameEvent[]): void {
    if (events.length === 0) return;
    const projected = events
      .map((event, index) => this.project(event, index))
      .filter((event): event is AudioEventPayload => Boolean(event));
    if (projected.length === 0) return;
    for (const client of this.options.clients()) {
      const listener = this.listener(client.sessionId);
      if (!listener) continue;
      const audible = projected
        .filter((event) => this.isAudible(event, listener, client.sessionId))
        .slice(0, this.maxEventsPerClient);
      if (audible.length === 0) continue;
      client.send(AUDIO_EVENTS_MESSAGE, {
        tick: projected[projected.length - 1].tick,
        events: audible
      } satisfies AudioEventsMessage);
    }
  }

  private listener(playerId: string): PlayerState | undefined {
    const player = this.options.state.players.get(playerId);
    return player?.alive ? player : undefined;
  }

  private isAudible(
    event: AudioEventPayload,
    listener: PlayerState,
    clientId: string
  ): boolean {
    if (event.sourceId === clientId) return true;
    return Math.hypot(event.x - listener.x, event.y - listener.y) <= this.audibleRadius;
  }

  private project(event: GameEvent, index: number): AudioEventPayload | undefined {
    const id = `${event.tick}:${index}:${event.type}`;
    switch (event.type) {
      case 'weapon.fired':
        return {
          id,
          tick: event.tick,
          kind: 'weapon.fire',
          x: event.x,
          y: event.y,
          variant: event.weapon,
          intensity: weaponIntensity(event.weapon),
          sourceId: event.ownerId
        };
      case 'melee.started':
        return {
          id,
          tick: event.tick,
          kind: 'melee.swing',
          x: event.x,
          y: event.y,
          variant: event.weapon,
          intensity: event.weapon === 'bat' ? 0.8 : 0.45,
          sourceId: event.playerId
        };
      case 'npc.melee.started':
        return {
          id,
          tick: event.tick,
          kind: 'melee.swing',
          x: event.x,
          y: event.y,
          variant: 'npc',
          intensity: 0.45,
          sourceId: event.npcId
        };
      case 'damage.applied': {
        const target = event.targetKind === 'player'
          ? this.options.state.players.get(event.targetId)
          : this.options.state.npcs.get(event.targetId);
        if (!target) return undefined;
        return {
          id,
          tick: event.tick,
          kind: 'melee.hit',
          x: target.x,
          y: target.y,
          variant: event.targetKind,
          intensity: Math.min(1, event.amount / 65),
          sourceId: event.attackerId
        };
      }
      case 'explosion.created':
        return {
          id,
          tick: event.tick,
          kind: 'explosion',
          x: event.x,
          y: event.y,
          variant: event.kind,
          intensity: Math.min(1, event.radius / 220),
          sourceId: event.sourceId
        };
      case 'vehicle.damaged': {
        const vehicle = this.options.state.vehicles.get(event.vehicleId);
        if (!vehicle || event.amount < 5) return undefined;
        return {
          id,
          tick: event.tick,
          kind: 'vehicle.impact',
          x: vehicle.x,
          y: vehicle.y,
          variant: event.sourceKind,
          intensity: Math.min(1, event.amount / 120),
          sourceId: event.sourceId
        };
      }
      case 'vehicle.ignited': {
        const vehicle = this.options.state.vehicles.get(event.vehicleId);
        if (!vehicle) return undefined;
        return {
          id,
          tick: event.tick,
          kind: 'vehicle.fire',
          x: vehicle.x,
          y: vehicle.y,
          variant: event.sourceKind,
          intensity: 0.85,
          sourceId: event.sourceId
        };
      }
      case 'vehicle.destroyed': {
        const vehicle = this.options.state.vehicles.get(event.vehicleId);
        if (!vehicle) return undefined;
        return {
          id,
          tick: event.tick,
          kind: 'vehicle.destroyed',
          x: vehicle.x,
          y: vehicle.y,
          variant: event.sourceKind,
          intensity: 1,
          sourceId: event.sourceId
        };
      }
      case 'vehicle.restored': {
        const vehicle = this.options.state.vehicles.get(event.vehicleId);
        if (!vehicle) return undefined;
        return {
          id,
          tick: event.tick,
          kind: 'vehicle.repaired',
          x: vehicle.x,
          y: vehicle.y,
          intensity: 0.5,
          sourceId: event.vehicleId
        };
      }
      case 'pickup.collected': {
        const player = this.options.state.players.get(event.playerId);
        if (!player) return undefined;
        return {
          id,
          tick: event.tick,
          kind: 'pickup.weapon',
          x: player.x,
          y: player.y,
          variant: event.weapon,
          intensity: 0.45,
          sourceId: event.playerId
        };
      }
      case 'cash-pickup.collected': {
        const player = this.options.state.players.get(event.playerId);
        if (!player) return undefined;
        return {
          id,
          tick: event.tick,
          kind: 'pickup.cash',
          x: player.x,
          y: player.y,
          intensity: Math.min(1, event.amount / 500),
          sourceId: event.playerId
        };
      }
      case 'player.respawned':
        return {
          id,
          tick: event.tick,
          kind: 'player.respawn',
          x: event.x,
          y: event.y,
          intensity: 0.4,
          sourceId: event.playerId
        };
      default:
        return undefined;
    }
  }
}

function weaponIntensity(weapon: string): number {
  if (weapon === 'rocket') return 1;
  if (weapon === 'shotgun') return 0.9;
  if (weapon === 'smg') return 0.62;
  return 0.48;
}

function positive(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${name} must be positive.`);
  return value;
}
