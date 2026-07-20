import type {DistrictState} from '../../state.ts';

// Field lists mirror the defineTypes() declarations in server/state.ts so the hash
// covers exactly the replicated simulation scalars, independent of schema internals.
const PLAYER_FIELDS = [
  'id', 'name', 'spaceId', 'surfaceId', 'x', 'y', 'angle', 'health', 'armor', 'wanted',
  'cash', 'alive', 'respawnAt', 'respawnCare', 'spawnProtected', 'vehicleId', 'vehicleSeat',
  'action', 'actionUntil', 'actionVehicleId', 'attackSequence', 'attackCombo',
  'reactionSequence', 'reactionKind', 'weapon', 'ammoPistol', 'ammoSmg', 'ammoShotgun',
  'ammoRocket', 'ammoGrenade', 'ammoMolotov', 'onFire', 'fireStartedAt', 'fireExpiresAt',
  'lastInputSequence', 'lastVehicleInputSequence'
] as const;

const NPC_FIELDS = [
  'id', 'kind', 'surfaceId', 'x', 'y', 'angle', 'health', 'armor', 'alive', 'action',
  'attackSequence', 'reactionSequence', 'reactionKind', 'ejectedAt', 'onFire',
  'fireStartedAt', 'fireExpiresAt'
] as const;

const VEHICLE_FIELDS = [
  'id', 'kind', 'surfaceId', 'x', 'y', 'angle', 'speed', 'linvelX', 'linvelY', 'angvel',
  'health', 'maxHealth',
  'engineDamage', 'damageFront', 'damageRear', 'damageLeft', 'damageRight', 'onFire',
  'fireStartedAt', 'destroyed', 'respawnAt', 'driverId', 'traffic', 'hijackBy', 'siren',
  'radioStation', 'tyreDamageMask'
] as const;

const BULLET_FIELDS = [
  'id', 'ownerId', 'ownerKind', 'surfaceId', 'x', 'y', 'angle', 'createdAt', 'weapon'
] as const;

const ROCKET_FIELDS = ['id', 'ownerId', 'surfaceId', 'x', 'y', 'angle', 'createdAt'] as const;

const THROWN_FIELDS = [
  'id', 'ownerId', 'kind', 'surfaceId', 'x', 'y', 'height', 'angle', 'createdAt', 'fuseAt'
] as const;

const EXPLOSION_FIELDS = [
  'id', 'kind', 'sourceId', 'sourceKind', 'surfaceId', 'x', 'y', 'radius', 'createdAt',
  'expiresAt'
] as const;

const FIRE_FIELDS = [
  'id', 'ownerId', 'surfaceId', 'x', 'y', 'radius', 'createdAt', 'expiresAt'
] as const;

const WEAPON_PICKUP_FIELDS = [
  'id', 'weapon', 'x', 'y', 'quantity', 'available', 'respawnAt'
] as const;

const CASH_PICKUP_FIELDS = [
  'id', 'ownerId', 'x', 'y', 'amount', 'availableAt', 'expiresAt'
] as const;

const TRAFFIC_SIGNAL_FIELDS = [
  'id', 'x', 'y', 'northSouth', 'eastWest', 'nextChangeAt'
] as const;

const SOCCER_BALL_FIELDS = [
  'id', 'surfaceId', 'x', 'y', 'angle', 'linvelX', 'linvelY', 'angvel'
] as const;

export function hashDistrictState(state: DistrictState): number {
  const stream = new HashStream();
  stream.number(state.worldTimeStartedAt);
  stream.number(state.serverTick);
  hashCollection(stream, state.players, PLAYER_FIELDS);
  hashCollection(stream, state.npcs, NPC_FIELDS);
  hashCollection(stream, state.vehicles, VEHICLE_FIELDS);
  hashCollection(stream, state.bullets, BULLET_FIELDS);
  hashCollection(stream, state.rockets, ROCKET_FIELDS);
  hashCollection(stream, state.thrownProjectiles, THROWN_FIELDS);
  hashCollection(stream, state.explosions, EXPLOSION_FIELDS);
  hashCollection(stream, state.fires, FIRE_FIELDS);
  hashCollection(stream, state.weaponPickups, WEAPON_PICKUP_FIELDS);
  hashCollection(stream, state.cashPickups, CASH_PICKUP_FIELDS);
  hashCollection(stream, state.trafficSignals, TRAFFIC_SIGNAL_FIELDS);
  hashCollection(stream, state.soccerBalls, SOCCER_BALL_FIELDS);
  stream.number(state.missions.size);
  stream.number(state.services.size);
  stream.number(state.stingers.size);
  return stream.value();
}

interface EntityCollection<Entity> {
  forEach(callback: (entity: Entity, key: string) => void): void;
}

function hashCollection<Entity>(
  stream: HashStream,
  collection: EntityCollection<Entity>,
  fields: readonly (keyof Entity & string)[]
): void {
  const entries: Array<[string, Entity]> = [];
  collection.forEach((entity, key) => entries.push([key, entity]));
  entries.sort(([first], [second]) => (first < second ? -1 : first > second ? 1 : 0));
  stream.number(entries.length);
  for (const [key, entity] of entries) {
    stream.string(key);
    for (const field of fields) {
      const value = entity[field] as unknown;
      if (typeof value === 'number') stream.number(value);
      else if (typeof value === 'boolean') stream.number(value ? 1 : 0);
      else stream.string(String(value ?? ''));
    }
  }
}

export class HashStream {
  private hash = 0x811c9dc5;
  private readonly scratch = new DataView(new ArrayBuffer(8));

  string(value: string): void {
    for (let index = 0; index < value.length; index++) {
      const code = value.charCodeAt(index);
      this.byte(code & 0xff);
      this.byte((code >>> 8) & 0xff);
    }
    this.byte(0xff);
  }

  number(value: number): void {
    this.scratch.setFloat64(0, value, true);
    for (let index = 0; index < 8; index++) this.byte(this.scratch.getUint8(index));
  }

  value(): number {
    let mixed = this.hash;
    mixed ^= mixed >>> 16;
    mixed = Math.imul(mixed, 0x7feb352d);
    mixed ^= mixed >>> 15;
    mixed = Math.imul(mixed, 0x846ca68b);
    mixed ^= mixed >>> 16;
    return mixed >>> 0;
  }

  private byte(value: number): void {
    this.hash ^= value;
    this.hash = Math.imul(this.hash, 0x01000193);
  }
}
