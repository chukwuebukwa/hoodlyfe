import assert from 'node:assert/strict';
import test from 'node:test';
import {MissionEntityScope} from '../server/game/missions/mission-entity-scope.ts';
import {
  MissionSystem,
  type MissionFailureReason,
  type MissionParticipantSnapshot,
  type MissionWorldSnapshot
} from '../server/game/missions/mission-system.ts';

function player(
  playerId: string,
  overrides: Partial<MissionParticipantSnapshot> = {}
): MissionParticipantSnapshot {
  return {
    playerId,
    exists: true,
    alive: true,
    vehicleId: '',
    wantedLevel: 0,
    x: 0,
    y: 0,
    ...overrides
  };
}

function world(overrides: Partial<MissionWorldSnapshot> = {}): MissionWorldSnapshot {
  return {
    nowMs: 1000,
    participants: [player('leader')],
    targetExists: true,
    targetDestroyed: false,
    targetHealth: 1000,
    targetMaxHealth: 1000,
    targetX: 500,
    targetY: 500,
    targetSpeed: 0,
    ...overrides
  };
}

function startMission(missions: MissionSystem, overrides: Record<string, unknown> = {}) {
  return missions.start({
    leaderId: 'leader',
    targetVehicleId: 'target',
    deliveryX: 900,
    deliveryY: 900,
    nowMs: 0,
    ...overrides
  });
}

test('Freemode mission forms an opt-in roster, caps it, and locks it explicitly', () => {
  const missions = new MissionSystem();
  const start = startMission(missions, {maximumParticipants: 2});
  assert.equal(start.ok, true);
  if (!start.ok) return;
  assert.equal(start.mission.phase, 'forming');
  assert.equal(missions.join(start.mission.id, 'support', 100).ok, true);
  assert.equal(missions.join(start.mission.id, 'extra', 200).ok, false);
  const launched = missions.launch(start.mission.id, 'support', 300);
  assert.deepEqual(launched, {ok: false, reason: 'not-leader'});
  const leaderLaunch = missions.launch(start.mission.id, 'leader', 300);
  assert.equal(leaderLaunch.ok, true);
  assert.equal(missions.get(start.mission.id)?.rosterLockedAt, 300);
  assert.deepEqual(missions.join(start.mission.id, 'late', 400), {ok: false, reason: 'roster-locked'});
});

test('participants and target cannot be reserved by overlapping missions', () => {
  const missions = new MissionSystem();
  const start = startMission(missions);
  assert.equal(start.ok, true);
  if (!start.ok) return;
  assert.equal(missions.start({
    leaderId: 'leader', targetVehicleId: 'other', deliveryX: 0, deliveryY: 0, nowMs: 0
  }).ok, false);
  assert.equal(missions.start({
    leaderId: 'other', targetVehicleId: 'target', deliveryX: 0, deliveryY: 0, nowMs: 0
  }).ok, false);
  assert.equal(missions.join(start.mission.id, 'support', 100).ok, true);
  assert.equal(missions.start({
    leaderId: 'support', targetVehicleId: 'third', deliveryX: 0, deliveryY: 0, nowMs: 100
  }).ok, false);
});

test('any roster member can steal the target and team heat controls delivery', () => {
  const missions = new MissionSystem();
  const start = startMission(missions);
  assert.equal(start.ok, true);
  if (!start.ok) return;
  missions.join(start.mission.id, 'support', 100);
  missions.join(start.mission.id, 'disconnected', 150);
  missions.launch(start.mission.id, 'leader', 200);

  assert.deepEqual(missions.update(start.mission.id, world({
    nowMs: 300,
    participants: [player('leader'), player('support', {vehicleId: 'target', wantedLevel: 1})]
  })), [{
    type: 'phase',
    missionId: start.mission.id,
    leaderId: 'leader',
    previousPhase: 'steal',
    phase: 'lose-heat'
  }]);
  const clearHeat = missions.update(start.mission.id, world({
    nowMs: 400,
    participants: [player('leader'), player('support', {vehicleId: 'target'})]
  }));
  assert.equal(clearHeat[0]?.type, 'phase');
  assert.equal(missions.get(start.mission.id)?.phase, 'deliver');
  missions.update(start.mission.id, world({
    nowMs: 500,
    participants: [player('leader', {wantedLevel: 2}), player('support', {vehicleId: 'target'})]
  }));
  assert.equal(missions.get(start.mission.id)?.phase, 'lose-heat');
});

test('individual death does not fail Freemode work and leadership transfers on disconnect', () => {
  const missions = new MissionSystem();
  const start = startMission(missions);
  assert.equal(start.ok, true);
  if (!start.ok) return;
  missions.join(start.mission.id, 'first-support', 100);
  missions.join(start.mission.id, 'second-support', 200);
  missions.launch(start.mission.id, 'leader', 300);

  const transitions = missions.update(start.mission.id, world({
    nowMs: 400,
    participants: [
      player('leader', {exists: false, alive: false}),
      player('first-support', {alive: false}),
      player('second-support')
    ]
  }));
  assert.equal(transitions[0]?.type, 'leader-transferred');
  assert.equal(missions.get(start.mission.id)?.leaderId, 'first-support');
  assert.equal(missions.get(start.mission.id)?.phase, 'steal');
  const firstSupport = missions.get(start.mission.id)?.participants.find(
    (participant) => participant.playerId === 'first-support'
  );
  assert.equal(firstSupport?.deaths, 1);
});

test('total disconnect, target destruction, timeout, and abandonment fail distinctly', () => {
  const cases: Array<[MissionFailureReason, Partial<MissionWorldSnapshot>]> = [
    ['all-participants-disconnected', {participants: [player('leader', {exists: false})]}],
    ['target-destroyed', {targetDestroyed: true}],
    ['time-expired', {nowMs: 200_000}]
  ];
  for (const [reason, overrides] of cases) {
    const missions = new MissionSystem();
    const start = startMission(missions);
    assert.equal(start.ok, true);
    if (!start.ok) continue;
    missions.launch(start.mission.id, 'leader', 100);
    const transition = missions.update(start.mission.id, world(overrides))[0];
    assert.equal(transition?.type, 'failed');
    if (transition?.type === 'failed') assert.equal(transition.reason, reason);
  }
  const missions = new MissionSystem();
  const start = startMission(missions);
  assert.equal(start.ok, true);
  if (start.ok) {
    assert.equal(missions.abandon(start.mission.id, 'stranger', 10).length, 0);
    assert.equal(missions.abandon(start.mission.id, 'leader', 10)[0]?.type, 'failed');
  }
});

test('delivery pays every locked participant once with stable individual keys', () => {
  const missions = new MissionSystem();
  const start = startMission(missions, {baseReward: 500});
  assert.equal(start.ok, true);
  if (!start.ok) return;
  missions.join(start.mission.id, 'support', 100);
  missions.launch(start.mission.id, 'leader', 200);
  missions.update(start.mission.id, world({
    nowMs: 300,
    participants: [player('leader'), player('support', {vehicleId: 'target'})]
  }));
  const completed = missions.update(start.mission.id, world({
    nowMs: 400,
    participants: [player('leader'), player('support', {vehicleId: 'target'})],
    targetX: 900,
    targetY: 900,
    targetSpeed: 10,
    targetHealth: 500
  }));
  assert.equal(completed[0]?.type, 'completed');
  if (completed[0]?.type !== 'completed') return;
  assert.equal(completed[0].condition, 0.5);
  assert.equal(completed[0].rewardPerParticipant, 337);
  assert.deepEqual(completed[0].payouts, [
    {playerId: 'leader', amount: 337, idempotencyKey: `${start.mission.id}:payout:leader`},
    {playerId: 'support', amount: 337, idempotencyKey: `${start.mission.id}:payout:support`}
  ]);
  assert.deepEqual(missions.update(start.mission.id, world()), []);
});

test('Getaway Run composes acquire, ordered checkpoints, heat escape, and delivery', () => {
  const missions = new MissionSystem();
  const start = startMission(missions, {
    templateId: 'getaway-run',
    checkpoints: [
      {id: 'one', x: 100, y: 100, radius: 50},
      {id: 'two', x: 200, y: 200, radius: 50},
      {id: 'three', x: 300, y: 300, radius: 50}
    ]
  });
  assert.equal(start.ok, true);
  if (!start.ok) return;
  missions.launch(start.mission.id, 'leader', 100);
  missions.update(start.mission.id, world({
    nowMs: 200,
    participants: [player('leader', {vehicleId: 'target', wantedLevel: 1})]
  }));
  assert.equal(missions.get(start.mission.id)?.phase, 'checkpoints');

  for (const [index, coordinate] of [100, 200, 300].entries()) {
    missions.update(start.mission.id, world({
      nowMs: 300 + index * 100,
      participants: [player('leader', {vehicleId: 'target', wantedLevel: 1})],
      targetX: coordinate,
      targetY: coordinate
    }));
  }
  assert.equal(missions.get(start.mission.id)?.checkpointIndex, 3);
  assert.equal(missions.get(start.mission.id)?.phase, 'lose-heat');

  missions.update(start.mission.id, world({
    nowMs: 700,
    participants: [player('leader', {vehicleId: 'target'})],
    targetX: 500,
    targetY: 500
  }));
  assert.equal(missions.get(start.mission.id)?.phase, 'deliver');
  const complete = missions.update(start.mission.id, world({
    nowMs: 800,
    participants: [player('leader', {vehicleId: 'target'})],
    targetX: 900,
    targetY: 900,
    targetSpeed: 20
  }));
  assert.equal(complete[0]?.type, 'completed');
  assert.equal(missions.get(start.mission.id)?.finalReward, 1_100);
});

test('Crew Checkpoint Rush advances from any living crew driver without a reserved target', () => {
  const missions = new MissionSystem();
  const checkpoints = [100, 200, 300, 400, 500].map((coordinate, index) => ({
    id: `route-${index + 1}`,
    x: coordinate,
    y: coordinate,
    radius: 50
  }));
  const start = missions.start({
    leaderId: 'leader',
    templateId: 'checkpoint-rush',
    checkpoints,
    nowMs: 0
  });
  assert.equal(start.ok, true);
  if (!start.ok) return;
  assert.equal(start.mission.targetVehicleId, '');
  assert.equal(missions.join(start.mission.id, 'support', 50).ok, true);
  missions.launch(start.mission.id, 'leader', 100);

  missions.update(start.mission.id, world({
    nowMs: 200,
    targetExists: false,
    targetDestroyed: true,
    participants: [
      player('leader', {x: 100, y: 100}),
      player('support', {vehicleId: 'car', alive: false, x: 100, y: 100})
    ]
  }));
  assert.equal(missions.get(start.mission.id)?.checkpointIndex, 0);

  for (const [index, coordinate] of [100, 200, 300, 400, 500].entries()) {
    const transitions = missions.update(start.mission.id, world({
      nowMs: 300 + index * 100,
      targetExists: false,
      targetDestroyed: true,
      participants: [
        player('leader'),
        player('support', {vehicleId: 'car', x: coordinate, y: coordinate})
      ]
    }));
    if (index < 4) assert.deepEqual(transitions, []);
  }
  const completed = missions.get(start.mission.id);
  assert.equal(completed?.phase, 'completed');
  assert.equal(completed?.finalReward, 900);
  assert.equal(completed?.payouts.length, 2);
  assert.equal(missions.isTargetReserved(''), false);
});

test('removal releases every participant and the reserved target', () => {
  const missions = new MissionSystem();
  const start = startMission(missions);
  assert.equal(start.ok, true);
  if (!start.ok) return;
  missions.join(start.mission.id, 'support', 100);
  assert.equal(missions.isTargetReserved('target'), true);
  missions.remove(start.mission.id);
  assert.equal(missions.isTargetReserved('target'), false);
  assert.equal(missions.getByParticipant('leader'), undefined);
  assert.equal(missions.getByParticipant('support'), undefined);
});

test('mission entity scope deduplicates ownership and drains deterministic cleanup records', () => {
  const scope = new MissionEntityScope(2);
  assert.equal(scope.track({missionId: 'mission', kind: 'vehicle', entityId: 'car', disposition: 'release'}), true);
  assert.equal(scope.track({missionId: 'mission', kind: 'vehicle', entityId: 'car', disposition: 'release'}), false);
  assert.equal(scope.track({missionId: 'mission', kind: 'npc', entityId: 'guard', disposition: 'despawn'}), true);
  assert.throws(() => scope.track({
    missionId: 'mission', kind: 'object', entityId: 'crate', disposition: 'despawn'
  }));
  assert.deepEqual(scope.drain('mission').map((record) => record.entityId), ['guard', 'car']);
  assert.deepEqual(scope.drain('mission'), []);
});
