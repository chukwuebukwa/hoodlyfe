import {MapSchema, Schema, defineTypes, view} from '@colyseus/schema';

export class PlayerAppearanceState extends Schema {
  outfitName = 'Street Fit';
  bodyType = 'standard';
  skinTone = 'bronze';
  hairStyle = 'cropped';
  hairColor = 'charcoal';
  headwear = 'none';
  topStyle = 'jacket';
  topColor = 'charcoal';
  accentColor = 'amber';
  bottomStyle = 'jeans';
  bottomColor = 'denim';
  shoeStyle = 'runners';
  shoeColor = 'white';
}

defineTypes(PlayerAppearanceState, {
  outfitName: 'string',
  bodyType: 'string',
  skinTone: 'string',
  hairStyle: 'string',
  hairColor: 'string',
  headwear: 'string',
  topStyle: 'string',
  topColor: 'string',
  accentColor: 'string',
  bottomStyle: 'string',
  bottomColor: 'string',
  shoeStyle: 'string',
  shoeColor: 'string'
});

export class PlayerState extends Schema {
  id = '';
  name = '';
  spaceId = 'street';
  x = 0;
  y = 0;
  angle = 0;
  health = 100;
  armor = 0;
  wanted = 0;
  cash = 0;
  alive = true;
  respawnAt = 0;
  respawnCare = '';
  spawnProtected = false;
  vehicleId = '';
  vehicleSeat = -1;
  action = '';
  actionUntil = 0;
  actionVehicleId = '';
  attackSequence = 0;
  attackCombo = 0;
  attackProgress = 0;
  reactionSequence = 0;
  reactionKind = '';
  reactionDirection = 'front';
  reactionProgress = 1;
  weapon = 'pistol';
  ammoPistol = 120;
  ammoSmg = 240;
  ammoShotgun = 48;
  ammoRocket = 4;
  ammoGrenade = 2;
  appearance = new PlayerAppearanceState();
}

defineTypes(PlayerState, {
  id: 'string',
  name: 'string',
  spaceId: 'string',
  x: 'number',
  y: 'number',
  angle: 'number',
  health: 'number',
  armor: 'number',
  wanted: 'number',
  cash: 'number',
  alive: 'boolean',
  respawnAt: 'number',
  respawnCare: 'string',
  spawnProtected: 'boolean',
  vehicleId: 'string',
  vehicleSeat: 'number',
  action: 'string',
  actionUntil: 'number',
  actionVehicleId: 'string',
  attackSequence: 'number',
  attackCombo: 'number',
  attackProgress: 'number',
  reactionSequence: 'number',
  reactionKind: 'string',
  reactionDirection: 'string',
  reactionProgress: 'number',
  weapon: 'string',
  ammoPistol: 'number',
  ammoSmg: 'number',
  ammoShotgun: 'number',
  ammoRocket: 'number',
  ammoGrenade: 'number',
  appearance: PlayerAppearanceState
});

export class BulletState extends Schema {
  id = '';
  ownerId = '';
  ownerKind = 'player';
  x = 0;
  y = 0;
  angle = 0;
  createdAt = 0;
  weapon = 'pistol';
}

defineTypes(BulletState, {
  id: 'string',
  ownerId: 'string',
  ownerKind: 'string',
  x: 'number',
  y: 'number',
  angle: 'number',
  createdAt: 'number',
  weapon: 'string'
});

export class ThrownProjectileState extends Schema {
  id = '';
  ownerId = '';
  kind = 'grenade';
  x = 0;
  y = 0;
  height = 0;
  angle = 0;
  createdAt = 0;
  fuseAt = 0;
}

defineTypes(ThrownProjectileState, {
  id: 'string',
  ownerId: 'string',
  kind: 'string',
  x: 'number',
  y: 'number',
  height: 'number',
  angle: 'number',
  createdAt: 'number',
  fuseAt: 'number'
});

export class RocketProjectileState extends Schema {
  id = '';
  ownerId = '';
  x = 0;
  y = 0;
  angle = 0;
  createdAt = 0;
}

defineTypes(RocketProjectileState, {
  id: 'string',
  ownerId: 'string',
  x: 'number',
  y: 'number',
  angle: 'number',
  createdAt: 'number'
});

export class ExplosionState extends Schema {
  id = '';
  kind = 'grenade';
  sourceId = '';
  sourceKind = 'world';
  x = 0;
  y = 0;
  radius = 0;
  createdAt = 0;
  expiresAt = 0;
}

defineTypes(ExplosionState, {
  id: 'string',
  kind: 'string',
  sourceId: 'string',
  sourceKind: 'string',
  x: 'number',
  y: 'number',
  radius: 'number',
  createdAt: 'number',
  expiresAt: 'number'
});

export class WeaponPickupState extends Schema {
  id = '';
  weapon = 'grenade';
  x = 0;
  y = 0;
  quantity = 0;
  available = true;
  respawnAt = 0;
}

defineTypes(WeaponPickupState, {
  id: 'string',
  weapon: 'string',
  x: 'number',
  y: 'number',
  quantity: 'number',
  available: 'boolean',
  respawnAt: 'number'
});

export class CashPickupState extends Schema {
  id = '';
  ownerId = '';
  x = 0;
  y = 0;
  amount = 0;
  availableAt = 0;
  expiresAt = 0;
}

defineTypes(CashPickupState, {
  id: 'string',
  ownerId: 'string',
  x: 'number',
  y: 'number',
  amount: 'number',
  availableAt: 'number',
  expiresAt: 'number'
});

export class TrafficSignalState extends Schema {
  id = '';
  x = 0;
  y = 0;
  northSouth = 'green';
  eastWest = 'red';
  nextChangeAt = 0;
}

defineTypes(TrafficSignalState, {
  id: 'string',
  x: 'number',
  y: 'number',
  northSouth: 'string',
  eastWest: 'string',
  nextChangeAt: 'number'
});

export class NpcState extends Schema {
  id = '';
  kind = 'civilian';
  x = 0;
  y = 0;
  angle = 0;
  health = 50;
  armor = 0;
  alive = true;
  action = 'wander';
  attackSequence = 0;
  attackProgress = 1;
  reactionSequence = 0;
  reactionKind = '';
  reactionDirection = 'front';
  reactionProgress = 1;
  ejectedAt = 0;
}

defineTypes(NpcState, {
  id: 'string',
  kind: 'string',
  x: 'number',
  y: 'number',
  angle: 'number',
  health: 'number',
  armor: 'number',
  alive: 'boolean',
  action: 'string',
  attackSequence: 'number',
  attackProgress: 'number',
  reactionSequence: 'number',
  reactionKind: 'string',
  reactionDirection: 'string',
  reactionProgress: 'number',
  ejectedAt: 'number'
});

export class VehicleState extends Schema {
  id = '';
  kind = 'sedan';
  x = 0;
  y = 0;
  angle = 0;
  speed = 0;
  health = 1000;
  maxHealth = 1000;
  engineDamage = 0;
  damageFront = 0;
  damageRear = 0;
  damageLeft = 0;
  damageRight = 0;
  onFire = false;
  fireStartedAt = 0;
  destroyed = false;
  respawnAt = 0;
  driverId = '';
  traffic = false;
  hijackBy = '';
  siren = false;
}

defineTypes(VehicleState, {
  id: 'string',
  kind: 'string',
  x: 'number',
  y: 'number',
  angle: 'number',
  speed: 'number',
  health: 'number',
  maxHealth: 'number',
  engineDamage: 'number',
  damageFront: 'number',
  damageRear: 'number',
  damageLeft: 'number',
  damageRight: 'number',
  onFire: 'boolean',
  fireStartedAt: 'number',
  destroyed: 'boolean',
  respawnAt: 'number',
  driverId: 'string',
  traffic: 'boolean',
  hijackBy: 'string',
  siren: 'boolean'
});

export class MissionParticipantState extends Schema {
  playerId = '';
  name = '';
  role = 'support';
  connected = true;
  alive = true;
  deaths = 0;
  activeMs = 0;
  contributionMs = 0;
}

export class StreetServiceState extends Schema {
  id = '';
  kind = 'ammunition';
  label = '';
  spaceId = 'street';
  x = 0;
  y = 0;
  radius = 0;
}

defineTypes(StreetServiceState, {
  id: 'string',
  kind: 'string',
  label: 'string',
  spaceId: 'string',
  x: 'number',
  y: 'number',
  radius: 'number'
});

defineTypes(MissionParticipantState, {
  playerId: 'string',
  name: 'string',
  role: 'string',
  connected: 'boolean',
  alive: 'boolean',
  deaths: 'number',
  activeMs: 'number',
  contributionMs: 'number'
});

export class MissionState extends Schema {
  id = '';
  templateId = '';
  leaderId = '';
  phase = '';
  objectiveId = '';
  objectiveKind = '';
  objectiveIndex = 0;
  objectiveCount = 0;
  targetVehicleId = '';
  targetNpcId = '';
  checkpointIndex = 0;
  checkpointCount = 0;
  checkpointX = 0;
  checkpointY = 0;
  checkpointRadius = 0;
  holdX = 0;
  holdY = 0;
  holdRadius = 0;
  holdProgressMs = 0;
  holdRequiredMs = 0;
  holdContested = false;
  encounterWave = 0;
  encounterWaveCount = 0;
  encounterRemaining = 0;
  encounterComplete = false;
  deliveryX = 0;
  deliveryY = 0;
  deliveryRadius = 0;
  maximumParticipants = 4;
  rosterLockedAt = 0;
  remainingMs = 0;
  projectedReward = 0;
  finalReward = 0;
  failureReason = '';
  participants = new MapSchema<MissionParticipantState>();
}

defineTypes(MissionState, {
  id: 'string',
  templateId: 'string',
  leaderId: 'string',
  phase: 'string',
  objectiveId: 'string',
  objectiveKind: 'string',
  objectiveIndex: 'number',
  objectiveCount: 'number',
  targetVehicleId: 'string',
  targetNpcId: 'string',
  checkpointIndex: 'number',
  checkpointCount: 'number',
  checkpointX: 'number',
  checkpointY: 'number',
  checkpointRadius: 'number',
  holdX: 'number',
  holdY: 'number',
  holdRadius: 'number',
  holdProgressMs: 'number',
  holdRequiredMs: 'number',
  holdContested: 'boolean',
  encounterWave: 'number',
  encounterWaveCount: 'number',
  encounterRemaining: 'number',
  encounterComplete: 'boolean',
  deliveryX: 'number',
  deliveryY: 'number',
  deliveryRadius: 'number',
  maximumParticipants: 'number',
  rosterLockedAt: 'number',
  remainingMs: 'number',
  projectedReward: 'number',
  finalReward: 'number',
  failureReason: 'string',
  participants: {map: MissionParticipantState}
});

export class DistrictState extends Schema {
  players = new MapSchema<PlayerState>();
  bullets = new MapSchema<BulletState>();
  rockets = new MapSchema<RocketProjectileState>();
  thrownProjectiles = new MapSchema<ThrownProjectileState>();
  explosions = new MapSchema<ExplosionState>();
  weaponPickups = new MapSchema<WeaponPickupState>();
  cashPickups = new MapSchema<CashPickupState>();
  trafficSignals = new MapSchema<TrafficSignalState>();
  npcs = new MapSchema<NpcState>();
  vehicles = new MapSchema<VehicleState>();
  missions = new MapSchema<MissionState>();
  services = new MapSchema<StreetServiceState>();
  missionContactX = 0;
  missionContactY = 0;
}

defineTypes(DistrictState, {
  players: {map: PlayerState},
  bullets: {map: BulletState},
  rockets: {map: RocketProjectileState},
  thrownProjectiles: {map: ThrownProjectileState},
  explosions: {map: ExplosionState},
  weaponPickups: {map: WeaponPickupState},
  cashPickups: {map: CashPickupState},
  trafficSignals: {map: TrafficSignalState},
  npcs: {map: NpcState},
  vehicles: {map: VehicleState},
  missions: {map: MissionState},
  services: {map: StreetServiceState},
  missionContactX: 'number',
  missionContactY: 'number'
});

for (const field of [
  'players',
  'bullets',
  'thrownProjectiles',
  'explosions',
  'weaponPickups',
  'cashPickups',
  'trafficSignals',
  'npcs',
  'vehicles',
  'missions',
  'services'
] as const) {
  view()(DistrictState.prototype, field);
}
