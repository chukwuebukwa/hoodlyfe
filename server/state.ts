import {MapSchema, Schema, defineTypes} from '@colyseus/schema';

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
  vehicleId = '';
  vehicleSeat = -1;
  action = '';
  actionUntil = 0;
  actionVehicleId = '';
  weapon = 'pistol';
  ammoPistol = 120;
  ammoSmg = 240;
  ammoShotgun = 48;
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
  vehicleId: 'string',
  vehicleSeat: 'number',
  action: 'string',
  actionUntil: 'number',
  actionVehicleId: 'string',
  weapon: 'string',
  ammoPistol: 'number',
  ammoSmg: 'number',
  ammoShotgun: 'number'
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
}

defineTypes(NpcState, {
  id: 'string',
  kind: 'string',
  x: 'number',
  y: 'number',
  angle: 'number',
  health: 'number',
  alive: 'boolean'
});

export class VehicleState extends Schema {
  id = '';
  kind = 'sedan';
  x = 0;
  y = 0;
  angle = 0;
  speed = 0;
  health = 100;
  driverId = '';
  traffic = false;
  hijackBy = '';
}

defineTypes(VehicleState, {
  id: 'string',
  kind: 'string',
  x: 'number',
  y: 'number',
  angle: 'number',
  speed: 'number',
  health: 'number',
  driverId: 'string',
  traffic: 'boolean',
  hijackBy: 'string'
});

export class DistrictState extends Schema {
  players = new MapSchema<PlayerState>();
  bullets = new MapSchema<BulletState>();
  npcs = new MapSchema<NpcState>();
  vehicles = new MapSchema<VehicleState>();
}

defineTypes(DistrictState, {
  players: {map: PlayerState},
  bullets: {map: BulletState},
  npcs: {map: NpcState},
  vehicles: {map: VehicleState}
});
