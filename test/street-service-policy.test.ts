import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AMMUNITION_CAPACITY,
  ARMOR_CAPACITY,
  ammunitionRestockQuote,
  combatResupplyQuote,
  medicalTreatmentQuote,
  vehicleRepairQuote
} from '../shared/content/street-services.ts';
import {
  projectInteractionAffordance,
  serviceMinimapPoints,
  storefrontMinimapPoints
} from '../src/game/interactions/interaction-presentation-policy.ts';
import type {
  DistrictNetworkState,
  NetworkPlayer,
  NetworkStreetService,
  NetworkVehicle
} from '../src/game/types.ts';
import {cloneAppearance} from '../shared/content/appearance-catalog.ts';

test('street service quotes charge for missing ammunition and layered vehicle damage', () => {
  assert.equal(ammunitionRestockQuote(AMMUNITION_CAPACITY), 0);
  assert.equal(ammunitionRestockQuote({...AMMUNITION_CAPACITY, ammoPistol: 119}), 25);
  assert.equal(ammunitionRestockQuote({...AMMUNITION_CAPACITY, ammoRocket: 0}), 300);
  assert.equal(ammunitionRestockQuote({ammoPistol: 0, ammoSmg: 0, ammoShotgun: 0}), 216);
  assert.equal(combatResupplyQuote({...AMMUNITION_CAPACITY, armor: ARMOR_CAPACITY}), 0);
  assert.equal(combatResupplyQuote({...AMMUNITION_CAPACITY, armor: 0}), 150);
  assert.equal(combatResupplyQuote({ammoPistol: 0, ammoSmg: 0, ammoShotgun: 0, armor: 0}), 366);
  assert.equal(medicalTreatmentQuote(100), 0);
  assert.equal(medicalTreatmentQuote(50), 138);
  assert.equal(medicalTreatmentQuote(-1000), 250);

  assert.equal(vehicleRepairQuote(createVehicle()), 0);
  assert.equal(vehicleRepairQuote(createVehicle({
    health: 700,
    engineDamage: 100,
    damageFront: 100
  })), 224);
  assert.equal(vehicleRepairQuote(createVehicle({
    health: -1000,
    engineDamage: 10_000,
    damageFront: 10_000
  })), 700);
});

test('interaction projection gives usable services priority over vehicle actions', () => {
  const state = createState();
  const player = state.players.get('local');
  assert.ok(player);
  state.services.set('ammo', createService({kind: 'ammunition', label: 'Combat Supply'}));
  player.ammoPistol = 100;

  assert.deepEqual(projectInteractionAffordance(state, player.id), {
    visible: true,
    kind: 'ammunition',
    label: 'RESUPPLY $272',
    touchLabel: 'GEAR',
    ariaLabel: 'Combat Supply, 272 dollars'
  });

  player.ammoPistol = AMMUNITION_CAPACITY.ammoPistol;
  player.ammoGrenade = AMMUNITION_CAPACITY.ammoGrenade;
  player.ammoMolotov = AMMUNITION_CAPACITY.ammoMolotov;
  player.armor = ARMOR_CAPACITY;
  assert.equal(projectInteractionAffordance(state, player.id).kind, 'hidden');

  state.services.set('hospital', createService({
    id: 'hospital',
    kind: 'hospital',
    label: 'Mercy Hospital',
    radius: 76
  }));
  player.health = 50;
  assert.deepEqual(projectInteractionAffordance(state, player.id), {
    visible: true,
    kind: 'hospital',
    label: 'TREAT $138',
    touchLabel: 'CARE',
    ariaLabel: 'Mercy Hospital, 138 dollars'
  });
  player.health = 100;

  state.services.set('clothing', createService({
    id: 'clothing',
    kind: 'clothing',
    label: 'Threads',
    radius: 76,
    spaceId: 'threads-showroom'
  }));
  assert.equal(projectInteractionAffordance(state, player.id).kind, 'hidden');
  player.spaceId = 'threads-showroom';
  assert.deepEqual(projectInteractionAffordance(state, player.id), {
    visible: true,
    kind: 'clothing',
    label: 'BROWSE LOOKS',
    touchLabel: 'STYLE',
    ariaLabel: 'Threads, open wardrobe'
  });
  state.services.delete('clothing');
  player.spaceId = 'street';

  const vehicle = createVehicle({health: 700, x: 0, y: 0, driverId: player.id});
  state.vehicles.set(vehicle.id, vehicle);
  state.services.set('repair', createService({
    id: 'repair',
    kind: 'repair',
    label: 'Repair Garage'
  }));
  player.vehicleId = vehicle.id;
  player.vehicleSeat = 0;
  assert.equal(projectInteractionAffordance(state, player.id).kind, 'repair');
  assert.equal(projectInteractionAffordance(state, player.id).label, 'REPAIR $156');

  vehicle.health = vehicle.maxHealth;
  assert.deepEqual(projectInteractionAffordance(state, player.id), {
    visible: true,
    kind: 'repair',
    label: 'INSTALL NEON $350',
    touchLabel: 'NEON',
    ariaLabel: 'Repair Garage, 350 dollars'
  });
  vehicle.neonColor = 'cyan';
  assert.equal(projectInteractionAffordance(state, player.id).label, 'NEON MAGENTA $75');
});

test('service minimap points preserve authoritative identities and positions', () => {
  const state = createState();
  state.services.set('ammo', createService({x: 10, y: 20}));
  state.services.set('threads', createService({
    id: 'threads',
    kind: 'clothing',
    x: 30,
    y: 40,
    spaceId: 'threads-showroom'
  }));
  assert.deepEqual(serviceMinimapPoints(state), [{
    id: 'ammo',
    kind: 'shop',
    x: 10,
    y: 20
  }]);
  assert.deepEqual(serviceMinimapPoints(state, 'threads-showroom'), [{
    id: 'threads',
    kind: 'shop',
    x: 30,
    y: 40
  }]);
});

test('street storefront blips expose every authored exterior with a dedicated kind', () => {
  const points = storefrontMinimapPoints();
  assert.deepEqual(points.map((point) => point.id), [
    'location-mercy-hospital',
    'location-ammunation-store',
    'location-threads-store',
    'location-southside-clinic'
  ]);
  assert.deepEqual(points.map((point) => point.kind), [
    'hospital',
    'ammunition',
    'clothing',
    'hospital'
  ]);
  assert.deepEqual(storefrontMinimapPoints('mercy-hospital'), []);
});

function createState(): DistrictNetworkState {
  return {
    players: new Map([['local', createPlayer()]]),
    bullets: new Map(),
    thrownProjectiles: new Map(),
    fires: new Map(),
    explosions: new Map(),
    weaponPickups: new Map(),
    npcs: new Map(),
    vehicles: new Map(),
    missions: new Map(),
    services: new Map(),
    missionContactX: 0,
    missionContactY: 0
  };
}

function createPlayer(overrides: Partial<NetworkPlayer> = {}): NetworkPlayer {
  return {
    id: 'local',
    name: 'Local',
    x: 0,
    y: 0,
    angle: 0,
    health: 100,
    wanted: 0,
    cash: 1000,
    alive: true,
    respawnAt: 0,
    vehicleId: '',
    vehicleSeat: -1,
    action: '',
    actionUntil: 0,
    actionVehicleId: '',
    weapon: 'pistol',
    ammoPistol: 120,
    ammoSmg: 240,
    ammoShotgun: 48,
    ammoGrenade: 2,
    ...overrides,
    appearance: overrides.appearance ?? cloneAppearance()
  };
}

function createVehicle(overrides: Partial<NetworkVehicle> = {}): NetworkVehicle {
  return {
    id: 'vehicle',
    kind: 'sedan',
    x: 0,
    y: 0,
    angle: 0,
    speed: 0,
    health: 1000,
    maxHealth: 1000,
    engineDamage: 0,
    tyreDamageMask: 0,
    damageFront: 0,
    damageRear: 0,
    damageLeft: 0,
    damageRight: 0,
    onFire: false,
    fireStartedAt: 0,
    destroyed: false,
    respawnAt: 0,
    driverId: '',
    traffic: false,
    hijackBy: '',
    ...overrides
  };
}

function createService(overrides: Partial<NetworkStreetService> = {}): NetworkStreetService {
  return {
    id: 'ammo',
    kind: 'ammunition',
    label: 'Ammunition',
    spaceId: 'street',
    x: 0,
    y: 0,
    radius: 72,
    ...overrides
  };
}
