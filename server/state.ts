import {MapSchema, Schema, defineTypes, view} from '@colyseus/schema';
import {STREET_GROUND_SURFACE_ID} from '../shared/world/surface-map.ts';

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
  lpcRecipe = '';
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
  shoeColor: 'string',
  lpcRecipe: 'string'
});

export class PlayerState extends Schema {
  id = '';
  name = '';
  spaceId = 'street';
  surfaceId = STREET_GROUND_SURFACE_ID;
  x = 0;
  y = 0;
  angle = 0;
  airborne = false;
  elevation = 0;
  verticalVelocity = 0;
  airborneVelocityX = 0;
  airborneVelocityY = 0;
  landingSurfaceId = '';
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
  ammoPistol = 108;
  ammoSmg = 210;
  ammoShotgun = 42;
  ammoRocket = 3;
  ammoGrenade = 2;
  ammoMolotov = 3;
  magazinePistol = 12;
  magazineSmg = 30;
  magazineShotgun = 6;
  magazineRocket = 1;
  reloadWeapon = '';
  reloadStartedAt = 0;
  reloadEndsAt = 0;
  reloadSequence = 0;
  shotSequence = 0;
  onFire = false;
  fireStartedAt = 0;
  fireExpiresAt = 0;
  lastInputSequence = 0;
  lastVehicleInputSequence = 0;
  appearance = new PlayerAppearanceState();
}

defineTypes(PlayerState, {
  id: 'string',
  name: 'string',
  spaceId: 'string',
  surfaceId: 'string',
  x: 'number',
  y: 'number',
  angle: 'number',
  airborne: 'boolean',
  elevation: 'number',
  verticalVelocity: 'number',
  airborneVelocityX: 'number',
  airborneVelocityY: 'number',
  landingSurfaceId: 'string',
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
  ammoMolotov: 'number',
  magazinePistol: 'number',
  magazineSmg: 'number',
  magazineShotgun: 'number',
  magazineRocket: 'number',
  reloadWeapon: 'string',
  reloadStartedAt: 'number',
  reloadEndsAt: 'number',
  reloadSequence: 'number',
  shotSequence: 'number',
  onFire: 'boolean',
  fireStartedAt: 'number',
  fireExpiresAt: 'number',
  lastInputSequence: 'number',
  lastVehicleInputSequence: 'number',
  appearance: PlayerAppearanceState
});

export class BulletState extends Schema {
  id = '';
  ownerId = '';
  ownerKind = 'player';
  surfaceId = STREET_GROUND_SURFACE_ID;
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
  surfaceId: 'string',
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
  surfaceId = STREET_GROUND_SURFACE_ID;
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
  surfaceId: 'string',
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
  surfaceId = STREET_GROUND_SURFACE_ID;
  x = 0;
  y = 0;
  angle = 0;
  createdAt = 0;
}

defineTypes(RocketProjectileState, {
  id: 'string',
  ownerId: 'string',
  surfaceId: 'string',
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
  surfaceId = STREET_GROUND_SURFACE_ID;
  x = 0;
  y = 0;
  radius = 0;
  createdAt = 0;
  expiresAt = 0;
}

export class FireZoneState extends Schema {
  id = '';
  ownerId = '';
  surfaceId = STREET_GROUND_SURFACE_ID;
  x = 0;
  y = 0;
  radius = 0;
  createdAt = 0;
  expiresAt = 0;
}

defineTypes(FireZoneState, {
  id: 'string',
  ownerId: 'string',
  surfaceId: 'string',
  x: 'number',
  y: 'number',
  radius: 'number',
  createdAt: 'number',
  expiresAt: 'number'
});

defineTypes(ExplosionState, {
  id: 'string',
  kind: 'string',
  sourceId: 'string',
  sourceKind: 'string',
  surfaceId: 'string',
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
  surfaceId = STREET_GROUND_SURFACE_ID;
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
  onFire = false;
  fireStartedAt = 0;
  fireExpiresAt = 0;
}

defineTypes(NpcState, {
  id: 'string',
  kind: 'string',
  surfaceId: 'string',
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
  ejectedAt: 'number',
  onFire: 'boolean',
  fireStartedAt: 'number',
  fireExpiresAt: 'number'
});

export class VehicleState extends Schema {
  id = '';
  kind = 'sedan';
  surfaceId = STREET_GROUND_SURFACE_ID;
  x = 0;
  y = 0;
  angle = 0;
  speed = 0;
  linvelX = 0;
  linvelY = 0;
  angvel = 0;
  airborne = false;
  elevation = 0;
  verticalVelocity = 0;
  landingSurfaceId = '';
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
  radioStation = 'station-0';
  tyreDamageMask = 0;
  neonColor = 'off';
}

defineTypes(VehicleState, {
  id: 'string',
  kind: 'string',
  surfaceId: 'string',
  x: 'number',
  y: 'number',
  angle: 'number',
  speed: 'number',
  linvelX: 'number',
  linvelY: 'number',
  angvel: 'number',
  airborne: 'boolean',
  elevation: 'number',
  verticalVelocity: 'number',
  landingSurfaceId: 'string',
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
  siren: 'boolean',
  radioStation: 'string',
  tyreDamageMask: 'number',
  neonColor: 'string'
});

export class SoccerBallState extends Schema {
  id = '';
  surfaceId = STREET_GROUND_SURFACE_ID;
  x = 0;
  y = 0;
  angle = 0;
  linvelX = 0;
  linvelY = 0;
  angvel = 0;
}

defineTypes(SoccerBallState, {
  id: 'string',
  surfaceId: 'string',
  x: 'number',
  y: 'number',
  angle: 'number',
  linvelX: 'number',
  linvelY: 'number',
  angvel: 'number'
});

export class StreetPropState extends Schema {
  id = '';
  definitionId = '';
  surfaceId = STREET_GROUND_SURFACE_ID;
  x = 0;
  y = 0;
  angle = 0;
  health = 1;
  maxHealth = 1;
  damageStage = 0;
  hitSequence = 0;
  hitAngle = 0;
  destroyed = false;
  resetAt = 0;
}

defineTypes(StreetPropState, {
  id: 'string',
  definitionId: 'string',
  surfaceId: 'string',
  x: 'number',
  y: 'number',
  angle: 'number',
  health: 'number',
  maxHealth: 'number',
  damageStage: 'number',
  hitSequence: 'number',
  hitAngle: 'number',
  destroyed: 'boolean',
  resetAt: 'number'
});

export class StingerState extends Schema {
  id = '';
  roadblockId = '';
  slotId = '';
  suspectId = '';
  ownerId = '';
  x = 0;
  y = 0;
  angle = 0;
  phase = 'preparing';
  phaseStartedAt = 0;
  createdAt = 0;
  activeSegmentCount = 0;
}

defineTypes(StingerState, {
  id: 'string',
  roadblockId: 'string',
  slotId: 'string',
  suspectId: 'string',
  ownerId: 'string',
  x: 'number',
  y: 'number',
  angle: 'number',
  phase: 'string',
  phaseStartedAt: 'number',
  createdAt: 'number',
  activeSegmentCount: 'number'
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

export class RaceEntrantState extends Schema {
  playerId = '';
  playerName = '';
  vehicleId = '';
  lap = 0;
  checkpointIndex = 0;
  position = 0;
  finished = false;
  finishTimeMs = 0;
  lastLapMs = 0;
  bestLapMs = 0;
  nextCheckpointX = 0;
  nextCheckpointY = 0;
  nextCheckpointRadius = 0;
}

defineTypes(RaceEntrantState, {
  playerId: 'string',
  playerName: 'string',
  vehicleId: 'string',
  lap: 'number',
  checkpointIndex: 'number',
  position: 'number',
  finished: 'boolean',
  finishTimeMs: 'number',
  lastLapMs: 'number',
  bestLapMs: 'number',
  nextCheckpointX: 'number',
  nextCheckpointY: 'number',
  nextCheckpointRadius: 'number'
});

export class ArenaRaceState extends Schema {
  trackId = '';
  trackLabel = '';
  phase = 'waiting';
  raceNumber = 1;
  lapsRequired = 3;
  countdownEndsAt = 0;
  startedAt = 0;
  finishedAt = 0;
  resultsEndsAt = 0;
  entrants = new MapSchema<RaceEntrantState>();
}

defineTypes(ArenaRaceState, {
  trackId: 'string',
  trackLabel: 'string',
  phase: 'string',
  raceNumber: 'number',
  lapsRequired: 'number',
  countdownEndsAt: 'number',
  startedAt: 'number',
  finishedAt: 'number',
  resultsEndsAt: 'number',
  entrants: {map: RaceEntrantState}
});

export class DeathmatchEntrantState extends Schema {
  playerId = '';
  playerName = '';
  kills = 0;
  deaths = 0;
  score = 0;
  streak = 0;
  position = 1;
  alive = true;
}

defineTypes(DeathmatchEntrantState, {
  playerId: 'string',
  playerName: 'string',
  kills: 'number',
  deaths: 'number',
  score: 'number',
  streak: 'number',
  position: 'number',
  alive: 'boolean'
});

export class ArenaDeathmatchState extends Schema {
  arenaId = '';
  arenaLabel = '';
  phase = 'waiting';
  matchNumber = 1;
  scoreLimit = 15;
  matchDurationMs = 0;
  countdownEndsAt = 0;
  startedAt = 0;
  endsAt = 0;
  finishedAt = 0;
  resultsEndsAt = 0;
  remainingMs = 0;
  winnerId = '';
  winnerName = '';
  entrants = new MapSchema<DeathmatchEntrantState>();
}

defineTypes(ArenaDeathmatchState, {
  arenaId: 'string',
  arenaLabel: 'string',
  phase: 'string',
  matchNumber: 'number',
  scoreLimit: 'number',
  matchDurationMs: 'number',
  countdownEndsAt: 'number',
  startedAt: 'number',
  endsAt: 'number',
  finishedAt: 'number',
  resultsEndsAt: 'number',
  remainingMs: 'number',
  winnerId: 'string',
  winnerName: 'string',
  entrants: {map: DeathmatchEntrantState}
});

export class DistrictState extends Schema {
  players = new MapSchema<PlayerState>();
  bullets = new MapSchema<BulletState>();
  rockets = new MapSchema<RocketProjectileState>();
  thrownProjectiles = new MapSchema<ThrownProjectileState>();
  explosions = new MapSchema<ExplosionState>();
  fires = new MapSchema<FireZoneState>();
  weaponPickups = new MapSchema<WeaponPickupState>();
  cashPickups = new MapSchema<CashPickupState>();
  trafficSignals = new MapSchema<TrafficSignalState>();
  npcs = new MapSchema<NpcState>();
  vehicles = new MapSchema<VehicleState>();
  soccerBalls = new MapSchema<SoccerBallState>();
  streetProps = new MapSchema<StreetPropState>();
  missions = new MapSchema<MissionState>();
  services = new MapSchema<StreetServiceState>();
  race = new ArenaRaceState();
  deathmatch = new ArenaDeathmatchState();
  worldTimeStartedAt = 0;
  worldTimeStartMinute = 0;
  worldTimeRate = 0;
  serverTick = 0;
  serverTimeMs = 0;
  missionContactX = 0;
  missionContactY = 0;
  stingers = new MapSchema<StingerState>();
}

defineTypes(DistrictState, {
  players: {map: PlayerState},
  bullets: {map: BulletState},
  rockets: {map: RocketProjectileState},
  thrownProjectiles: {map: ThrownProjectileState},
  explosions: {map: ExplosionState},
  fires: {map: FireZoneState},
  weaponPickups: {map: WeaponPickupState},
  cashPickups: {map: CashPickupState},
  trafficSignals: {map: TrafficSignalState},
  npcs: {map: NpcState},
  vehicles: {map: VehicleState},
  soccerBalls: {map: SoccerBallState},
  streetProps: {map: StreetPropState},
  missions: {map: MissionState},
  services: {map: StreetServiceState},
  race: ArenaRaceState,
  deathmatch: ArenaDeathmatchState,
  worldTimeStartedAt: 'number',
  worldTimeStartMinute: 'number',
  worldTimeRate: 'number',
  serverTick: 'number',
  serverTimeMs: 'number',
  missionContactX: 'number',
  missionContactY: 'number',
  stingers: {map: StingerState}
});

for (const field of [
  'players',
  'bullets',
  'thrownProjectiles',
  'explosions',
  'fires',
  'weaponPickups',
  'cashPickups',
  'trafficSignals',
  'npcs',
  'vehicles',
  'soccerBalls',
  'streetProps',
  'missions',
  'race',
  'deathmatch',
  'services',
  'stingers'
] as const) {
  view()(DistrictState.prototype, field);
}
