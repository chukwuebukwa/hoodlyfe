import type {GameEvent} from '../events/game-events.ts';
import type {DistrictState} from '../../state.ts';
import {
  PedestrianStimulusRegistry,
  type PedestrianStimulusKind,
  type RegisterPedestrianStimulusInput
} from './pedestrian-stimulus-registry.ts';

interface PedestrianStimulusAdapterOptions {
  state: DistrictState;
  registry: PedestrianStimulusRegistry;
}

export class PedestrianStimulusAdapter {
  constructor(private readonly options: PedestrianStimulusAdapterOptions) {}

  ingest(events: readonly GameEvent[]): void {
    for (const event of events) {
      const input = this.fromEvent(event);
      if (input) this.options.registry.register(input);
    }
  }

  private fromEvent(event: GameEvent): RegisterPedestrianStimulusInput | undefined {
    switch (event.type) {
      case 'weapon.fired':
        return stimulus(
          'gunshot', event.ownerId, event.ownerId, event.x, event.y,
          weaponSeverity(event.weapon), weaponRadius(event.weapon), event.nowMs,
          1400, `gunshot:${event.ownerKind}:${event.ownerId}`, 180
        );
      case 'explosion.created':
        return stimulus(
          'explosion', event.sourceId, event.explosionId, event.x, event.y,
          1, Math.max(720, event.radius * 5.5), event.nowMs,
          4200, `explosion:${event.explosionId}`, 1000
        );
      case 'damage.applied': {
        const position = this.entityPosition(event.targetKind, event.targetId);
        if (!position) return undefined;
        return stimulus(
          'injury', event.attackerId, event.targetId, position.x, position.y,
          clamp(0.58 + event.amount / 100, 0.58, 0.9), 380, event.nowMs,
          2400, `injury:${event.targetKind}:${event.targetId}`, 300
        );
      }
      case 'entity.killed': {
        const position = this.entityPosition(event.entityKind, event.entityId);
        if (!position) return undefined;
        return stimulus(
          'death', event.attackerId, event.entityId, position.x, position.y,
          0.98, 500, event.nowMs, 3800,
          `death:${event.entityKind}:${event.entityId}`, 1000
        );
      }
      case 'vehicle.damaged': {
        if (event.sourceKind === 'weapon' || event.sourceKind === 'explosion') return undefined;
        const vehicle = this.options.state.vehicles.get(event.vehicleId);
        if (!vehicle) return undefined;
        return stimulus(
          'impact', event.sourceId, event.vehicleId, vehicle.x, vehicle.y,
          clamp(0.2 + event.amount / 180, 0.2, 0.78), 280, event.nowMs,
          1100, `impact:${event.vehicleId}:${event.sourceId || event.sourceKind}`, 240
        );
      }
      case 'vehicle.ignited': {
        const vehicle = this.options.state.vehicles.get(event.vehicleId);
        if (!vehicle) return undefined;
        return stimulus(
          'fire', event.sourceId, event.vehicleId, vehicle.x, vehicle.y,
          0.9, 440, event.nowMs, 5200,
          `fire:${event.vehicleId}`, 1000
        );
      }
      default:
        return undefined;
    }
  }

  private entityPosition(kind: 'player' | 'npc', id: string): {x: number; y: number} | undefined {
    const entity = kind === 'player'
      ? this.options.state.players.get(id)
      : this.options.state.npcs.get(id);
    return entity ? {x: entity.x, y: entity.y} : undefined;
  }
}

function stimulus(
  kind: PedestrianStimulusKind,
  sourceId: string,
  subjectId: string,
  x: number,
  y: number,
  severity: number,
  radius: number,
  occurredAt: number,
  lifetimeMs: number,
  dedupeKey: string,
  dedupeMs: number
): RegisterPedestrianStimulusInput {
  return {
    kind, sourceId, subjectId, x, y, severity, radius,
    occurredAt, lifetimeMs, dedupeKey, dedupeMs
  };
}

function weaponSeverity(weapon: string): number {
  if (weapon === 'shotgun') return 1;
  if (weapon === 'smg') return 0.9;
  return 0.84;
}

function weaponRadius(weapon: string): number {
  if (weapon === 'shotgun') return 600;
  if (weapon === 'smg') return 540;
  return 500;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
