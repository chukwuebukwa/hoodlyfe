import {MapSchema, Schema, defineTypes} from '@colyseus/schema';

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
  x = 0;
  y = 0;
  angle = 0;
  health = 100;
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
  weapon = 'pistol';
  ammoPistol = 120;
  ammoSmg = 240;
  ammoShotgun = 48;
  appearance = new PlayerAppearanceState();
}

defineTypes(PlayerState, {
  id: 'string',
  name: 'string',
  x: 'number',
  y: 'number',
  angle: 'number',
  health: 'number',
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
  weapon: 'string',
  ammoPistol: 'number',
  ammoSmg: 'number',
  ammoShotgun: 'number',
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

export class NpcState extends Schema {
  id = '';
  kind = 'civilian';
  x = 0;
  y = 0;
  angle = 0;
  health = 50;
  alive = true;
  action = 'wander';
}

defineTypes(NpcState, {
  id: 'string',
  kind: 'string',
  x: 'number',
  y: 'number',
  angle: 'number',
  health: 'number',
  alive: 'boolean',
  action: 'string'
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
  x = 0;
  y = 0;
  radius = 0;
}

defineTypes(StreetServiceState, {
  id: 'string',
  kind: 'string',
  label: 'string',
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
  npcs: {map: NpcState},
  vehicles: {map: VehicleState},
  missions: {map: MissionState},
  services: {map: StreetServiceState},
  missionContactX: 'number',
  missionContactY: 'number'
});
