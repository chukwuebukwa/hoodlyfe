import type {VehicleKind} from '../../shared/content/vehicle-catalog.ts';
import type {StreetServiceKind} from '../../shared/content/street-services.ts';
import type {
  MissionObjectiveKind,
  MissionTemplateId
} from '../../shared/content/mission-catalog.ts';
import type {PlayerAppearance} from '../../shared/content/appearance-catalog.ts';
import type {BulletWeaponId, WeaponId} from '../../shared/content/weapon-catalog.ts';

export type CombatReactionKind = '' | 'flinch' | 'stagger' | 'knockdown';
export type CombatReactionDirection = 'front' | 'left' | 'back' | 'right';

export interface NetworkPlayer {
  id: string;
  name: string;
  spaceId?: string;
  surfaceId?: string;
  x: number;
  y: number;
  angle: number;
  health: number;
  armor?: number;
  wanted: number;
  cash: number;
  alive: boolean;
  respawnAt: number;
  respawnCare?: '' | 'public' | 'trauma';
  spawnProtected?: boolean;
  vehicleId: string;
  vehicleSeat: number;
  action: '' | 'entering' | 'hijacking' | 'melee' | 'hit' | 'knockdown';
  actionUntil: number;
  actionVehicleId: string;
  attackSequence?: number;
  attackCombo?: number;
  attackProgress?: number;
  reactionSequence?: number;
  reactionKind?: CombatReactionKind;
  reactionDirection?: CombatReactionDirection;
  reactionProgress?: number;
  weapon: WeaponId;
  ammoPistol: number;
  ammoSmg: number;
  ammoShotgun: number;
  ammoRocket?: number;
  ammoGrenade: number;
  ammoMolotov?: number;
  onFire?: boolean;
  fireStartedAt?: number;
  fireExpiresAt?: number;
  lastInputSequence?: number;
  lastVehicleInputSequence?: number;
  appearance: PlayerAppearance;
}

export interface NetworkBullet {
  id: string;
  ownerId: string;
  ownerKind: string;
  surfaceId?: string;
  x: number;
  y: number;
  angle: number;
  createdAt: number;
  weapon: BulletWeaponId;
}

export interface NetworkThrownProjectile {
  id: string;
  ownerId: string;
  kind: 'grenade' | 'molotov';
  surfaceId?: string;
  x: number;
  y: number;
  height: number;
  angle: number;
  createdAt: number;
  fuseAt: number;
}

export interface NetworkRocketProjectile {
  id: string;
  ownerId: string;
  surfaceId?: string;
  x: number;
  y: number;
  angle: number;
  createdAt: number;
}

export interface NetworkExplosion {
  id: string;
  kind: 'grenade' | 'rocket' | 'vehicle';
  sourceId: string;
  sourceKind: 'player' | 'vehicle' | 'world';
  surfaceId?: string;
  x: number;
  y: number;
  radius: number;
  createdAt: number;
  expiresAt: number;
}

export interface NetworkFireZone {
  id: string;
  ownerId: string;
  surfaceId?: string;
  x: number;
  y: number;
  radius: number;
  createdAt: number;
  expiresAt: number;
}

export interface NetworkWeaponPickup {
  id: string;
  weapon: 'grenade' | 'molotov';
  x: number;
  y: number;
  quantity: number;
  available: boolean;
  respawnAt: number;
}

export interface NetworkCashPickup {
  id: string;
  ownerId: string;
  x: number;
  y: number;
  amount: number;
  availableAt: number;
  expiresAt: number;
}

export interface NetworkTrafficSignal {
  id: string;
  x: number;
  y: number;
  northSouth: 'green' | 'yellow' | 'red';
  eastWest: 'green' | 'yellow' | 'red';
  nextChangeAt: number;
}

export interface NetworkNpc {
  id: string;
  kind: 'civilian' | 'police' | 'hostile';
  surfaceId?: string;
  x: number;
  y: number;
  angle: number;
  health: number;
  armor?: number;
  alive: boolean;
  action: 'wander' | 'startle' | 'flee' | 'investigate' | 'recover' | 'assault' | 'pursue' | 'search' | 'melee' | 'dead';
  attackSequence?: number;
  attackProgress?: number;
  reactionSequence?: number;
  reactionKind?: CombatReactionKind;
  reactionDirection?: CombatReactionDirection;
  reactionProgress?: number;
  ejectedAt?: number;
  onFire?: boolean;
  fireStartedAt?: number;
  fireExpiresAt?: number;
}

export interface NetworkVehicle {
  id: string;
  kind: VehicleKind;
  surfaceId?: string;
  x: number;
  y: number;
  angle: number;
  speed: number;
  health: number;
  maxHealth: number;
  engineDamage: number;
  tyreDamageMask: number;
  damageFront: number;
  damageRear: number;
  damageLeft: number;
  damageRight: number;
  onFire: boolean;
  fireStartedAt: number;
  destroyed: boolean;
  respawnAt: number;
  driverId: string;
  traffic: boolean;
  hijackBy: string;
  siren?: boolean;
  radioStation?: string;
}

export interface NetworkStinger {
  id: string;
  roadblockId: string;
  slotId: string;
  suspectId: string;
  ownerId: string;
  x: number;
  y: number;
  angle: number;
  phase: 'preparing' | 'deploying' | 'deployed' | 'retiring';
  phaseStartedAt: number;
  createdAt: number;
  activeSegmentCount: number;
}

export interface NetworkMissionParticipant {
  playerId: string;
  name: string;
  role: 'leader' | 'support';
  connected: boolean;
  alive: boolean;
  deaths: number;
  activeMs: number;
  contributionMs: number;
}

export interface NetworkStreetService {
  id: string;
  kind: StreetServiceKind;
  label: string;
  spaceId?: string;
  x: number;
  y: number;
  radius: number;
}

export interface NetworkMission {
  id: string;
  templateId: MissionTemplateId;
  leaderId: string;
  phase: 'forming' | 'steal' | 'checkpoints' | 'hold' | 'eliminate' | 'lose-heat' | 'deliver' | 'completed' | 'failed';
  objectiveId: string;
  objectiveKind: MissionObjectiveKind;
  objectiveIndex: number;
  objectiveCount: number;
  targetVehicleId: string;
  targetNpcId?: string;
  checkpointIndex: number;
  checkpointCount: number;
  checkpointX: number;
  checkpointY: number;
  checkpointRadius: number;
  holdX: number;
  holdY: number;
  holdRadius: number;
  holdProgressMs: number;
  holdRequiredMs: number;
  holdContested: boolean;
  encounterWave: number;
  encounterWaveCount: number;
  encounterRemaining: number;
  encounterComplete: boolean;
  deliveryX: number;
  deliveryY: number;
  deliveryRadius: number;
  maximumParticipants: number;
  rosterLockedAt: number;
  remainingMs: number;
  projectedReward: number;
  finalReward: number;
  failureReason: string;
  participants: Map<string, NetworkMissionParticipant>;
}

export interface DistrictNetworkState {
  players: Map<string, NetworkPlayer>;
  bullets: Map<string, NetworkBullet>;
  rockets?: Map<string, NetworkRocketProjectile>;
  thrownProjectiles: Map<string, NetworkThrownProjectile>;
  explosions: Map<string, NetworkExplosion>;
  fires: Map<string, NetworkFireZone>;
  weaponPickups: Map<string, NetworkWeaponPickup>;
  cashPickups?: Map<string, NetworkCashPickup>;
  trafficSignals?: Map<string, NetworkTrafficSignal>;
  npcs: Map<string, NetworkNpc>;
  vehicles: Map<string, NetworkVehicle>;
  stingers?: Map<string, NetworkStinger>;
  missions: Map<string, NetworkMission>;
  services: Map<string, NetworkStreetService>;
  worldTimeStartedAt?: number;
  worldTimeStartMinute?: number;
  worldTimeRate?: number;
  serverTick?: number;
  serverTimeMs?: number;
  missionContactX: number;
  missionContactY: number;
}
