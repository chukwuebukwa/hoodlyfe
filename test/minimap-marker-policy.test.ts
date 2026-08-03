import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildMinimapFrame,
  drivingRange,
  type MinimapMarker,
  type MinimapNpcInput,
  type MinimapPlayerInput,
  type MinimapVehicleInput
} from '../src/game/minimap-marker-policy.ts';

const players: MinimapPlayerInput[] = [
  {id: 'local', x: 100, y: 100, angle: 0, alive: true, wanted: 0, vehicleId: ''},
  {id: 'remote', x: 300, y: 100, angle: 1, alive: true, wanted: 0, vehicleId: 'remote-car'},
  {id: 'dead', x: 140, y: 100, angle: 0, alive: false, wanted: 0, vehicleId: ''}
];
const vehicles: MinimapVehicleInput[] = [
  {id: 'remote-car', x: 360, y: 120, angle: 2, speed: 180, destroyed: false},
  {id: 'ambient', x: 130, y: 130, angle: 0, speed: 80, destroyed: false}
];
const npcs: MinimapNpcInput[] = [
  {id: 'police-near', kind: 'police', x: 500, y: 100, angle: 0, alive: true},
  {id: 'civilian', kind: 'civilian', x: 120, y: 120, angle: 0, alive: true}
];

test('minimap shows one local marker and remote players at effective vehicle positions', () => {
  const frame = buildMinimapFrame({localPlayerId: 'local', players, vehicles, npcs});
  assert.ok(frame);
  assert.equal(frame.range, 520);
  assert.deepEqual(frame.markers.map((marker) => marker.id), [
    'player:remote',
    'local:local'
  ]);
  const remote = frame.markers.find((marker) => marker.id === 'player:remote');
  assert.deepEqual(remote && {x: remote.x, y: remote.y, angle: remote.angle}, {x: 360, y: 120, angle: 2});
  assert.equal(frame.markers.some((marker) => marker.id.includes('ambient')), false);
  assert.equal(frame.markers.some((marker) => marker.id.includes('civilian')), false);
});

test('minimap origin and local marker use the effective predicted attachment root', () => {
  const localPose = {x: 145, y: 82, angle: -0.75};
  const frame = buildMinimapFrame({
    localPlayerId: 'local',
    localPose,
    players,
    vehicles,
    npcs
  });
  assert.ok(frame);
  assert.deepEqual(
    {x: frame.originX, y: frame.originY, angle: frame.heading},
    localPose
  );
  const local = frame.markers.find((marker) => marker.id === 'local:local');
  assert.deepEqual(local && {x: local.x, y: local.y, angle: local.angle}, localPose);
});

test('police appear only for wanted local players and distant objectives clamp', () => {
  const wantedPlayers = players.map((player) => player.id === 'local' ? {...player, wanted: 2} : player);
  const frame = buildMinimapFrame({
    localPlayerId: 'local',
    players: wantedPlayers,
    vehicles,
    npcs,
    points: [
      {id: 'delivery', kind: 'objective', x: 1400, y: 100},
      {id: 'far-shop', kind: 'shop', x: 1400, y: 100}
    ]
  });
  assert.ok(frame);
  assert.ok(frame.markers.some((marker) => marker.id === 'police:police-near'));
  assert.equal(frame.markers.find((marker) => marker.id === 'objective:delivery')?.clamped, true);
  assert.equal(frame.markers.some((marker) => marker.id === 'shop:far-shop'), false);
});

test('driving radar range grows continuously with absolute speed and stays bounded', () => {
  assert.equal(drivingRange(0), 620);
  assert.equal(drivingRange(410), 1100);
  assert.equal(drivingRange(-999), 1100);
  assert.ok(drivingRange(205) > drivingRange(100));
});

test('available weapon pickup projects a stable nearby minimap marker', () => {
  const frame = buildMinimapFrame({
    localPlayerId: 'local',
    players,
    vehicles,
    npcs,
    points: [{id: 'grenade-cache', kind: 'pickup', x: 180, y: 100}]
  });
  const pickup = frame?.markers.find((marker) => marker.id === 'pickup:grenade-cache');
  assert.ok(pickup);
  assert.equal(pickup.kind, 'pickup');
  assert.equal(pickup.priority, 45);
  assert.equal(pickup.clamped, false);
});

test('permanent GTA-style locations remain edge-clamped outside radar range', () => {
  const frame = buildMinimapFrame({
    localPlayerId: 'local',
    players,
    vehicles,
    npcs,
    points: [
      {id: 'ammunation', kind: 'ammunition', x: 2400, y: 100},
      {id: 'threads', kind: 'clothing', x: 2600, y: 100},
      {id: 'hospital', kind: 'hospital', x: 2800, y: 100},
      {id: 'quick-stop', kind: 'shop', x: 3000, y: 100, permanent: true}
    ]
  });
  assert.ok(frame);
  for (const kind of ['ammunition', 'clothing', 'hospital', 'shop'] as const) {
    const marker: MinimapMarker | undefined = frame.markers.find((candidate) => candidate.kind === kind);
    assert.ok(marker);
    assert.equal(marker.clamped, true);
  }
});

test('mission contacts preserve their letter and color while edge-clamped', () => {
  const frame = buildMinimapFrame({
    localPlayerId: 'local',
    players,
    vehicles,
    npcs,
    points: [{
      id: 'mission-contact:holdout',
      kind: 'contact',
      x: 2400,
      y: 100,
      label: 'H',
      color: 0xff5e4d
    }]
  });
  const marker = frame?.markers.find((candidate) => candidate.kind === 'contact');
  assert.ok(marker);
  assert.equal(marker.label, 'H');
  assert.equal(marker.color, 0xff5e4d);
  assert.equal(marker.clamped, true);
});
