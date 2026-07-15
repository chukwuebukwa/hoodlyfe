import type {DistrictState} from '../../state.ts';
import type {GameEvent} from '../events/game-events.ts';
import {
  type RegisterWorldStimulusInput,
  type WorldStimulusChannel,
  type WorldStimulusEntityKind,
  type WorldStimulusKind,
  WorldStimulusRegistry
} from './world-stimulus-registry.ts';

interface WorldStimulusAdapterOptions {
  state: DistrictState;
  registry: WorldStimulusRegistry;
}

export class WorldStimulusAdapter {
  constructor(private readonly options: WorldStimulusAdapterOptions) {}

  ingest(events: readonly GameEvent[]): void {
    for (const event of events) {
      const input = this.fromEvent(event);
      if (input) this.options.registry.register(input);
    }
  }

  private fromEvent(event: GameEvent): RegisterWorldStimulusInput | undefined {
    switch (event.type) {
      case 'weapon.fired': {
        const ownerKind = event.ownerKind === 'player' ? 'player' : 'npc';
        return this.input(event, {
          kind: 'gunshot',
          sourceId: event.ownerId,
          sourceKind: ownerKind,
          subjectId: event.ownerId,
          subjectKind: ownerKind,
          actorId: event.ownerId,
          actorKind: ownerKind,
          spaceId: this.spaceFor(ownerKind, event.ownerId),
          x: event.x,
          y: event.y,
          intensity: weaponIntensity(event.weapon),
          radius: weaponRadius(event.weapon),
          channels: ['hearing'],
          lifetimeMs: 1400,
          dedupeKey: `gunshot:${event.ownerKind}:${event.ownerId}`,
          dedupeMs: 180
        });
      }
      case 'explosion.created': {
        const sourceKind = normalizeEntityKind(event.sourceKind);
        return this.input(event, {
          kind: 'explosion',
          sourceId: event.sourceId,
          sourceKind,
          subjectId: event.explosionId,
          subjectKind: 'effect',
          actorId: event.sourceId,
          actorKind: sourceKind,
          spaceId: this.spaceFor(sourceKind, event.sourceId),
          x: event.x,
          y: event.y,
          intensity: 1,
          radius: Math.max(720, event.radius * 5.5),
          channels: ['hearing', 'sight'],
          lifetimeMs: 4200,
          dedupeKey: `explosion:${event.explosionId}`,
          dedupeMs: 1000
        });
      }
      case 'fire.created': {
        const sourceKind = this.identityKind(event.sourceId);
        return this.input(event, {
          kind: 'fire',
          sourceId: event.sourceId,
          sourceKind,
          subjectId: event.fireId,
          subjectKind: 'effect',
          actorId: event.sourceId,
          actorKind: sourceKind,
          spaceId: this.spaceFor(sourceKind, event.sourceId),
          x: event.x,
          y: event.y,
          intensity: 0.92,
          radius: Math.max(460, event.radius * 6),
          channels: ['sight'],
          lifetimeMs: Math.max(2400, event.expiresAt - event.nowMs),
          dedupeKey: `fire:${event.fireId}`,
          dedupeMs: 1000
        });
      }
      case 'damage.applied': {
        const position = this.entityPosition(event.targetKind, event.targetId);
        if (!position) return undefined;
        const actorKind = this.identityKind(event.attackerId);
        return this.input(event, {
          kind: 'injury',
          sourceId: event.attackerId,
          sourceKind: actorKind,
          subjectId: event.targetId,
          subjectKind: event.targetKind,
          actorId: event.attackerId,
          actorKind,
          spaceId: position.spaceId,
          x: position.x,
          y: position.y,
          intensity: clamp(0.58 + event.amount / 100, 0.58, 0.9),
          radius: 380,
          channels: ['hearing', 'sight'],
          lifetimeMs: 2400,
          dedupeKey: `injury:${event.targetKind}:${event.targetId}`,
          dedupeMs: 300
        });
      }
      case 'entity.killed': {
        const position = this.entityPosition(event.entityKind, event.entityId);
        if (!position) return undefined;
        const actorKind = this.identityKind(event.attackerId);
        return this.input(event, {
          kind: 'death',
          sourceId: event.attackerId,
          sourceKind: actorKind,
          subjectId: event.entityId,
          subjectKind: event.entityKind,
          actorId: event.attackerId,
          actorKind,
          spaceId: position.spaceId,
          x: position.x,
          y: position.y,
          intensity: 0.98,
          radius: 500,
          channels: ['hearing', 'sight'],
          lifetimeMs: 3800,
          dedupeKey: `death:${event.entityKind}:${event.entityId}`,
          dedupeMs: 1000
        });
      }
      case 'vehicle.damaged': {
        if (event.sourceKind === 'weapon' || event.sourceKind === 'explosion') return undefined;
        const vehicle = this.options.state.vehicles.get(event.vehicleId);
        if (!vehicle) return undefined;
        const actorKind = normalizeEntityKind(event.sourceKind);
        return this.input(event, {
          kind: 'impact',
          sourceId: event.sourceId,
          sourceKind: actorKind,
          subjectId: event.vehicleId,
          subjectKind: 'vehicle',
          actorId: event.sourceId,
          actorKind,
          spaceId: 'street',
          x: vehicle.x,
          y: vehicle.y,
          intensity: clamp(0.2 + event.amount / 180, 0.2, 0.78),
          radius: 280,
          channels: ['hearing', 'contact'],
          lifetimeMs: 1100,
          dedupeKey: `impact:${event.vehicleId}:${event.sourceId || event.sourceKind}`,
          dedupeMs: 240
        });
      }
      case 'vehicle.ignited': {
        const vehicle = this.options.state.vehicles.get(event.vehicleId);
        if (!vehicle) return undefined;
        const actorKind = this.sourceEntityKind(event.sourceKind, event.sourceId);
        return this.input(event, {
          kind: 'fire',
          sourceId: event.sourceId,
          sourceKind: actorKind,
          subjectId: event.vehicleId,
          subjectKind: 'vehicle',
          actorId: event.sourceId,
          actorKind,
          spaceId: 'street',
          x: vehicle.x,
          y: vehicle.y,
          intensity: 0.9,
          radius: 440,
          channels: ['sight'],
          lifetimeMs: 5200,
          dedupeKey: `fire:${event.vehicleId}`,
          dedupeMs: 1000
        });
      }
      default:
        return undefined;
    }
  }

  private input(
    event: GameEvent,
    values: {
      kind: WorldStimulusKind;
      sourceId: string;
      sourceKind: WorldStimulusEntityKind;
      subjectId: string;
      subjectKind: WorldStimulusEntityKind;
      actorId: string;
      actorKind: WorldStimulusEntityKind;
      spaceId: string;
      x: number;
      y: number;
      intensity: number;
      radius: number;
      channels: WorldStimulusChannel[];
      lifetimeMs: number;
      dedupeKey: string;
      dedupeMs: number;
    }
  ): RegisterWorldStimulusInput {
    return {
      ...values,
      provenance: event.type,
      occurredAt: event.nowMs
    };
  }

  private identityKind(id: string): WorldStimulusEntityKind {
    if (!id) return 'world';
    if (this.options.state.players.has(id)) return 'player';
    if (this.options.state.npcs.has(id)) return 'npc';
    if (this.options.state.vehicles.has(id)) return 'vehicle';
    return 'world';
  }

  private sourceEntityKind(sourceKind: string, sourceId: string): WorldStimulusEntityKind {
    const directKind = normalizeEntityKind(sourceKind);
    return directKind === 'world' && sourceKind !== 'world'
      ? this.identityKind(sourceId)
      : directKind;
  }

  private spaceFor(kind: WorldStimulusEntityKind, id: string): string {
    if (kind === 'player') return this.options.state.players.get(id)?.spaceId ?? 'street';
    return 'street';
  }

  private entityPosition(
    kind: 'player' | 'npc',
    id: string
  ): {x: number; y: number; spaceId: string} | undefined {
    if (kind === 'player') {
      const player = this.options.state.players.get(id);
      return player ? {x: player.x, y: player.y, spaceId: player.spaceId} : undefined;
    }
    const npc = this.options.state.npcs.get(id);
    return npc ? {x: npc.x, y: npc.y, spaceId: 'street'} : undefined;
  }
}

function normalizeEntityKind(kind: string): WorldStimulusEntityKind {
  if (kind === 'player' || kind === 'vehicle') return kind;
  return 'world';
}

function weaponIntensity(weapon: string): number {
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
