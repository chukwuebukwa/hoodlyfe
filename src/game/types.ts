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
}

export interface NetworkVehicle {
  id: string;
  kind: 'sedan' | 'police' | 'taxi';
  x: number;
  y: number;
  angle: number;
  speed: number;
  health: number;
  destroyed: boolean;
  respawnAt: number;
  driverId: string;
  traffic: boolean;
  hijackBy: string;
}

export interface DistrictNetworkState {
  players: Map<string, NetworkPlayer>;
  bullets: Map<string, NetworkBullet>;
  npcs: Map<string, NetworkNpc>;
  vehicles: Map<string, NetworkVehicle>;
}
