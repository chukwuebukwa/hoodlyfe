import assert from 'node:assert/strict';
import test from 'node:test';
import {
  missionMinimapPoints,
  projectMissionHud,
  projectMissionWorld
} from '../src/game/missions/mission-presentation-policy.ts';
import type {
  DistrictNetworkState,
  NetworkMission,
  NetworkMissionParticipant,
  NetworkPlayer,
  NetworkVehicle
} from '../src/game/types.ts';

test('mission HUD projects street contact and deterministic nearby crew joining', () => {
  const state = createState();
  const contact = projectMissionHud(state, 'local');
  assert.equal(contact.visible, true);
  assert.equal(contact.action, 'start');
  assert.equal(contact.timer, 'AVAILABLE');

  const leader = createPlayer({id: 'leader', name: 'Leader', x: 100, y: 0});
  state.players.set('leader', leader);
  const mission = createMission({leaderId: 'leader'});
  mission.participants.set('leader', participant(leader, 'leader'));
  state.missions.set(mission.id, mission);
  const joinable = projectMissionHud(state, 'local');
  assert.equal(joinable.action, 'join');
  assert.equal(joinable.missionId, mission.id);
  assert.equal(joinable.objective, 'Leader is forming a crew.');

  leader.x = 400;
  assert.equal(projectMissionHud(state, 'local').action, 'start');
  mission.maximumParticipants = 1;
  assert.equal(projectMissionHud(state, 'local').action, 'start');
});

test('participant priority and leader controls follow authoritative mission phase', () => {
  const state = createState();
  const mission = createMission();
  const local = state.players.get('local');
  assert.ok(local);
  mission.participants.set('local', participant(local, 'leader'));
  state.missions.set(mission.id, mission);

  const forming = projectMissionHud(state, 'local');
  assert.equal(forming.action, 'launch');
  assert.equal(forming.timer, '03:00');
  mission.phase = 'steal';
  const steal = projectMissionHud(state, 'local');
  assert.equal(steal.action, 'abandon');
  assert.equal(steal.actionWarning, true);
  assert.equal(steal.objective, 'Steal the marked traffic vehicle.');

  mission.phase = 'completed';
  mission.finalReward = 725;
  const completed = projectMissionHud(state, 'local');
  assert.equal(completed.action, '');
  assert.equal(completed.objective, 'Job complete. Crew paid $725 each.');
});

test('mission world and minimap share target and delivery phase projection', () => {
  const state = createState();
  const mission = createMission({phase: 'steal'});
  const local = state.players.get('local');
  assert.ok(local);
  mission.participants.set('local', participant(local, 'leader'));
  state.missions.set(mission.id, mission);
  state.vehicles.set('target', createVehicle());

  assert.deepEqual(projectMissionWorld(state, 'local').target, {x: 80, y: 90, angle: 0.5});
  assert.equal(missionMinimapPoints(state, 'local').at(-1)?.id, `${mission.id}:target`);

  mission.phase = 'deliver';
  const world = projectMissionWorld(state, 'local');
  assert.deepEqual(world.delivery, {x: 500, y: 600, radius: 70});
  assert.equal(missionMinimapPoints(state, 'local').at(-1)?.id, `${mission.id}:delivery`);
});

function createState(): DistrictNetworkState {
  return {
    players: new Map([['local', createPlayer()]]),
    bullets: new Map(),
    npcs: new Map(),
    vehicles: new Map(),
    missions: new Map(),
    missionContactX: 0,
    missionContactY: 0
  };
}

function createMission(overrides: Partial<NetworkMission> = {}): NetworkMission {
  return {
    id: 'mission-1',
    templateId: 'boost-and-deliver',
    leaderId: 'local',
    phase: 'forming',
    targetVehicleId: 'target',
    deliveryX: 500,
    deliveryY: 600,
    deliveryRadius: 70,
    maximumParticipants: 4,
    rosterLockedAt: 0,
    remainingMs: 180_000,
    projectedReward: 600,
    finalReward: 0,
    failureReason: '',
    participants: new Map(),
    ...overrides
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
    cash: 0,
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
    ...overrides
  };
}

function createVehicle(): NetworkVehicle {
  return {
    id: 'target',
    kind: 'sedan',
    x: 80,
    y: 90,
    angle: 0.5,
    speed: 0,
    health: 1000,
    maxHealth: 1000,
    engineDamage: 0,
    damageFront: 0,
    damageRear: 0,
    damageLeft: 0,
    damageRight: 0,
    onFire: false,
    fireStartedAt: 0,
    destroyed: false,
    respawnAt: 0,
    driverId: '',
    traffic: true,
    hijackBy: ''
  };
}

function participant(
  player: NetworkPlayer,
  role: NetworkMissionParticipant['role']
): NetworkMissionParticipant {
  return {
    playerId: player.id,
    name: player.name,
    role,
    connected: true,
    alive: true,
    deaths: 0,
    activeMs: 0
  };
}
