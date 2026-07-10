import type {VehicleKind} from '../../shared/content/vehicle-catalog.ts';

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
  vehicleId: string;
  vehicleSeat: number;
  action: '' | 'entering' | 'hijacking';
  actionUntil: number;
  actionVehicleId: string;
  weapon: 'pistol' | 'smg' | 'shotgun';
  ammoPistol: number;
  ammoSmg: number;
  ammoShotgun: number;
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

export interface NetworkNpc {
  id: string;
  kind: 'civilian' | 'police';
  x: number;
  y: number;
  angle: number;
  health: number;
  alive: boolean;
  action: 'wander' | 'startle' | 'flee' | 'investigate' | 'recover' | 'pursue' | 'search' | 'dead';
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
}

export interface NetworkMissionParticipant {
  playerId: string;
  name: string;
  role: 'leader' | 'support';
  connected: boolean;
  alive: boolean;
  deaths: number;
  activeMs: number;
}

export interface NetworkMission {
  id: string;
  templateId: 'boost-and-deliver';
  leaderId: string;
  phase: 'forming' | 'steal' | 'lose-heat' | 'deliver' | 'completed' | 'failed';
  targetVehicleId: string;
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
  npcs: Map<string, NetworkNpc>;
  vehicles: Map<string, NetworkVehicle>;
  missions: Map<string, NetworkMission>;
  missionContactX: number;
  missionContactY: number;
}
