import assert from 'node:assert/strict';
import test from 'node:test';
import {
  missionMinimapPoints,
  projectMissionHud,
  projectMissionWorld
} from '../src/game/missions/mission-presentation-policy.ts';
import {
  activeObjectiveTarget,
  objectiveArrowPose
} from '../src/game/missions/objective-direction-policy.ts';
import type {
  DistrictNetworkState,
  NetworkMission,
  NetworkMissionParticipant,
  NetworkPlayer,
  NetworkVehicle
} from '../src/game/types.ts';
import {cloneAppearance} from '../shared/content/appearance-catalog.ts';

test('mission HUD projects street contact and deterministic nearby crew joining', () => {
  const state = createState();
  const contact = projectMissionHud(state, 'local');
  assert.equal(contact.visible, true);
  assert.equal(contact.action, 'start');
  assert.equal(contact.timer, 'AVAILABLE');
  const getaway = projectMissionHud(state, 'local', 'getaway-run');
  assert.equal(getaway.title, 'Getaway Run');
  assert.equal(getaway.templateSelectorVisible, true);
  assert.match(getaway.objective, /route/);
  const rush = projectMissionHud(state, 'local', 'checkpoint-rush');
  assert.equal(rush.title, 'Crew Checkpoint Rush');
  assert.match(rush.objective, /crew vehicle/);
  const holdout = projectMissionHud(state, 'local', 'crew-holdout');
  assert.equal(holdout.title, 'Crew Holdout');
  assert.match(holdout.objective, /three escalating waves/);
  const mostWanted = projectMissionHud(state, 'local', 'most-wanted');
  assert.equal(mostWanted.title, 'Most Wanted');
  assert.match(mostWanted.objective, /crime boss/);

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

  mission.phase = 'checkpoints';
  mission.objectiveKind = 'vehicle-checkpoints';
  mission.checkpointIndex = 1;
  mission.checkpointCount = 3;
  mission.checkpointX = 320;
  mission.checkpointY = 440;
  mission.checkpointRadius = 82;
  assert.deepEqual(projectMissionWorld(state, 'local').checkpoint, {x: 320, y: 440, radius: 82});
  assert.equal(
    missionMinimapPoints(state, 'local').find((point) => point.id.includes('checkpoint'))?.x,
    320
  );
});

test('target-free checkpoint HUD and world projection expose only the shared route', () => {
  const state = createState();
  const mission = createMission({
    templateId: 'checkpoint-rush',
    phase: 'checkpoints',
    objectiveId: 'run-crew-route',
    objectiveKind: 'crew-checkpoints',
    objectiveCount: 1,
    targetVehicleId: '',
    checkpointIndex: 2,
    checkpointCount: 5,
    checkpointX: 420,
    checkpointY: 220,
    checkpointRadius: 82,
    projectedReward: 900
  });
  const local = state.players.get('local');
  assert.ok(local);
  mission.participants.set('local', participant(local, 'leader'));
  state.missions.set(mission.id, mission);

  const hud = projectMissionHud(state, 'local');
  assert.equal(hud.title, 'Crew Checkpoint Rush');
  assert.equal(hud.objective, 'Get any crew vehicle through checkpoint 3 of 5.');
  assert.equal(projectMissionWorld(state, 'local').target, undefined);
  assert.deepEqual(projectMissionWorld(state, 'local').checkpoint, {
    x: 420,
    y: 220,
    radius: 82
  });
  assert.deepEqual(
    missionMinimapPoints(state, 'local').map((point) => point.id),
    ['freemode-contact', `${mission.id}:checkpoint:2`]
  );
});

test('Holdout presentation exposes wave pressure, contested zone, and hostile minimap points', () => {
  const state = createState();
  const mission = createMission({
    templateId: 'crew-holdout',
    phase: 'hold',
    objectiveId: 'defend-holdout',
    objectiveKind: 'hold-area',
    objectiveCount: 1,
    targetVehicleId: '',
    holdX: 300,
    holdY: 400,
    holdRadius: 140,
    holdProgressMs: 8_000,
    holdRequiredMs: 25_000,
    holdContested: true,
    encounterWave: 2,
    encounterWaveCount: 3,
    encounterRemaining: 3,
    encounterComplete: false,
    projectedReward: 1_200
  });
  const local = state.players.get('local');
  assert.ok(local);
  mission.participants.set('local', participant(local, 'leader'));
  state.missions.set(mission.id, mission);
  state.npcs.set('hostile-1', {
    id: 'hostile-1',
    kind: 'hostile',
    x: 340,
    y: 400,
    angle: 0,
    health: 75,
    alive: true,
    action: 'assault'
  });

  const hud = projectMissionHud(state, 'local');
  assert.equal(hud.meta, 'W2/3 | 3 LEFT | $1200');
  assert.match(hud.objective, /Zone contested/);
  assert.deepEqual(projectMissionWorld(state, 'local').hold, {
    x: 300,
    y: 400,
    radius: 140,
    contested: true
  });
  const points = missionMinimapPoints(state, 'local');
  assert.equal(points.some((point) => point.id === `${mission.id}:hold`), true);
  assert.equal(points.some((point) => point.kind === 'hostile' && point.x === 340), true);
});

test('Most Wanted presentation transitions from hideout to the replicated target actor', () => {
  const state = createState();
  const mission = createMission({
    templateId: 'most-wanted',
    phase: 'eliminate',
    objectiveId: 'eliminate-boss',
    objectiveKind: 'eliminate-target',
    objectiveCount: 1,
    targetVehicleId: '',
    holdX: 300,
    holdY: 400,
    holdRadius: 140,
    encounterWave: 1,
    encounterWaveCount: 2,
    encounterRemaining: 3,
    encounterComplete: false,
    projectedReward: 1_500
  });
  const local = state.players.get('local');
  assert.ok(local);
  mission.participants.set('local', participant(local, 'leader'));
  state.missions.set(mission.id, mission);

  assert.deepEqual(projectMissionWorld(state, 'local').target, {x: 300, y: 400, angle: 0});
  assert.match(projectMissionHud(state, 'local').objective, /Clear the guards/);
  assert.equal(missionMinimapPoints(state, 'local').at(-1)?.id, `${mission.id}:hideout`);

  mission.targetNpcId = `${mission.id}:target`;
  state.npcs.set(mission.targetNpcId, {
    id: mission.targetNpcId,
    kind: 'hostile',
    x: 360,
    y: 420,
    angle: 1.2,
    health: 220,
    alive: true,
    action: 'assault'
  });
  assert.deepEqual(projectMissionWorld(state, 'local').target, {x: 360, y: 420, angle: 1.2});
  assert.equal(projectMissionHud(state, 'local').objective, 'Eliminate the marked crime boss.');
  assert.equal(
    missionMinimapPoints(state, 'local').find((point) => point.id.includes(':target'))?.kind,
    'objective'
  );
});

test('objective arrow follows the active phase destination without exposing the passive contact', () => {
  const state = createState();
  assert.equal(activeObjectiveTarget(state, 'local'), undefined);

  const mission = createMission({phase: 'steal'});
  const local = state.players.get('local');
  assert.ok(local);
  mission.participants.set('local', participant(local, 'leader'));
  state.missions.set(mission.id, mission);
  state.vehicles.set('target', createVehicle());
  assert.deepEqual(activeObjectiveTarget(state, 'local'), {
    id: 'mission:target',
    x: 80,
    y: 90,
    kind: 'target'
  });

  mission.phase = 'deliver';
  assert.deepEqual(activeObjectiveTarget(state, 'local'), {
    id: 'mission:delivery',
    x: 500,
    y: 600,
    kind: 'delivery'
  });
});

test('objective arrow pose orbits the player, points at the destination, and hides on arrival', () => {
  assert.deepEqual(objectiveArrowPose({x: 10, y: 20}, {x: 110, y: 20}), {
    x: 62,
    y: 20,
    angle: 0,
    distance: 100
  });
  const north = objectiveArrowPose({x: 10, y: 20}, {x: 10, y: 120});
  assert.ok(north);
  assert.ok(Math.abs(north.x - 10) < 0.000_001);
  assert.equal(north.y, 72);
  assert.equal(north.angle, Math.PI / 2);
  assert.equal(objectiveArrowPose({x: 10, y: 20}, {x: 20, y: 20}), undefined);
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

function createMission(overrides: Partial<NetworkMission> = {}): NetworkMission {
  return {
    id: 'mission-1',
    templateId: 'boost-and-deliver',
    leaderId: 'local',
    phase: 'forming',
    objectiveId: 'acquire-target',
    objectiveKind: 'acquire-vehicle',
    objectiveIndex: 0,
    objectiveCount: 3,
    targetVehicleId: 'target',
    checkpointIndex: 0,
    checkpointCount: 0,
    checkpointX: 0,
    checkpointY: 0,
    checkpointRadius: 0,
    holdX: 0,
    holdY: 0,
    holdRadius: 0,
    holdProgressMs: 0,
    holdRequiredMs: 0,
    holdContested: false,
    encounterWave: 0,
    encounterWaveCount: 0,
    encounterRemaining: 0,
    encounterComplete: true,
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
    ammoGrenade: 2,
    ...overrides,
    appearance: overrides.appearance ?? cloneAppearance()
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
    activeMs: 0,
    contributionMs: 0
  };
}
