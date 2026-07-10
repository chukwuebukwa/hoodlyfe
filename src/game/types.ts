import type {VehicleKind} from '../../shared/content/vehicle-catalog.ts';
import type {StreetServiceKind} from '../../shared/content/street-services.ts';
import type {
  MissionObjectiveKind,
  MissionTemplateId
} from '../../shared/content/mission-catalog.ts';
import type {PlayerAppearance} from '../../shared/content/appearance-catalog.ts';

export interface NetworkPlayer {
  id: string;
  name: string;
  x: number;
  y: number;
  angle: number;
  health: number;
  wanted: number;
  cash: number;
  alive: boolean;
  respawnAt: number;
  respawnCare?: '' | 'public' | 'trauma';
  spawnProtected?: boolean;
  vehicleId: string;
  vehicleSeat: number;
  action: '' | 'entering' | 'hijacking';
  actionUntil: number;
  actionVehicleId: string;
  weapon: 'pistol' | 'smg' | 'shotgun' | 'grenade';
  ammoPistol: number;
  ammoSmg: number;
  ammoShotgun: number;
  ammoGrenade: number;
  appearance: PlayerAppearance;
}

export interface NetworkBullet {
  id: string;
  ownerId: string;
  ownerKind: string;
  x: number;
  y: number;
  angle: number;
  createdAt: number;
  weapon: 'pistol' | 'smg' | 'shotgun';
}

export interface NetworkThrownProjectile {
  id: string;
  ownerId: string;
  kind: 'grenade';
  x: number;
  y: number;
  height: number;
  angle: number;
  createdAt: number;
  fuseAt: number;
}

export interface NetworkExplosion {
  id: string;
  kind: 'grenade' | 'vehicle';
  sourceId: string;
  sourceKind: 'player' | 'vehicle' | 'world';
  x: number;
  y: number;
  radius: number;
  createdAt: number;
  expiresAt: number;
}

export interface NetworkWeaponPickup {
  id: string;
  weapon: 'grenade';
  x: number;
  y: number;
  quantity: number;
  available: boolean;
  respawnAt: number;
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
  x: number;
  y: number;
  angle: number;
  health: number;
  alive: boolean;
  action: 'wander' | 'startle' | 'flee' | 'investigate' | 'recover' | 'assault' | 'pursue' | 'search' | 'dead';
}

export interface NetworkVehicle {
  id: string;
  kind: VehicleKind;
  x: number;
  y: number;
  angle: number;
  speed: number;
  health: number;
  maxHealth: number;
  engineDamage: number;
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
  x: number;
  y: number;
  radius: number;
}

export interface NetworkMission {
  id: string;
  templateId: MissionTemplateId;
  leaderId: string;
  phase: 'forming' | 'steal' | 'checkpoints' | 'hold' | 'lose-heat' | 'deliver' | 'completed' | 'failed';
  objectiveId: string;
  objectiveKind: MissionObjectiveKind;
  objectiveIndex: number;
  objectiveCount: number;
  targetVehicleId: string;
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
  thrownProjectiles: Map<string, NetworkThrownProjectile>;
  explosions: Map<string, NetworkExplosion>;
  weaponPickups: Map<string, NetworkWeaponPickup>;
  trafficSignals?: Map<string, NetworkTrafficSignal>;
  npcs: Map<string, NetworkNpc>;
  vehicles: Map<string, NetworkVehicle>;
  missions: Map<string, NetworkMission>;
  services: Map<string, NetworkStreetService>;
  missionContactX: number;
  missionContactY: number;
}
