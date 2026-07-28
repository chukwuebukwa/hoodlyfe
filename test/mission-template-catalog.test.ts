import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MISSION_CONTACT_RADIUS,
  MISSION_CONTACTS,
  MISSION_TEMPLATE_IDS,
  MISSION_REWARD_POLICIES,
  MISSION_TARGET_MODES,
  isMissionTemplateId,
  missionCheckpointCount,
  missionContact,
  missionContactNear,
  missionHoldDuration,
  missionTemplate
} from '../shared/content/mission-catalog.ts';
import {CollisionMap} from '../server/world-map.ts';

test('mission catalog exposes bounded composable templates with unique objectives', () => {
  assert.deepEqual(MISSION_TEMPLATE_IDS, [
    'boost-and-deliver',
    'getaway-run',
    'checkpoint-rush',
    'crew-holdout',
    'most-wanted'
  ]);
  for (const templateId of MISSION_TEMPLATE_IDS) {
    const definition = missionTemplate(templateId);
    assert.equal(definition.id, templateId);
    assert.equal(definition.contact.templateId, templateId);
    assert.ok(definition.label.length > 0);
    assert.ok(definition.summary.length > 0);
    assert.ok(definition.baseReward > 0);
    assert.ok(definition.durationMs >= 10_000);
    assert.ok(definition.maximumParticipants >= 1 && definition.maximumParticipants <= 4);
    assert.ok(MISSION_TARGET_MODES.includes(definition.targetMode));
    assert.ok(MISSION_REWARD_POLICIES.includes(definition.rewardPolicy));
    assert.ok(definition.objectives.length >= 1 && definition.objectives.length <= 8);
    assert.equal(new Set(definition.objectives.map((objective) => objective.id)).size, definition.objectives.length);
    if (definition.encounter) {
      assert.ok(definition.encounter.waves.length >= 1 && definition.encounter.waves.length <= 10);
      assert.ok(definition.encounter.waves.every((wave) => wave.count >= 1 && wave.count <= 16));
      assert.ok(definition.encounter.waves.every((wave) => (
        (wave.additionalPerParticipant ?? 0) >= 0 &&
        (wave.role !== 'target' || (wave.count === 1 && !wave.additionalPerParticipant))
      )));
      assert.ok(definition.encounter.waves.filter((wave) => wave.role === 'target').length <= 1);
    }
  }
  assert.equal(missionCheckpointCount('boost-and-deliver'), 0);
  assert.equal(missionCheckpointCount('getaway-run'), 3);
  assert.equal(missionCheckpointCount('checkpoint-rush'), 5);
  assert.equal(missionHoldDuration('crew-holdout'), 25_000);
  assert.equal(missionHoldDuration('most-wanted'), 0);
});

test('mission contacts are unique, distributed, walkable, and proximity-selected', () => {
  assert.equal(isMissionTemplateId('getaway-run'), true);
  assert.equal(isMissionTemplateId('unknown'), false);
  assert.equal(MISSION_CONTACTS.length, MISSION_TEMPLATE_IDS.length);
  assert.equal(new Set(MISSION_CONTACTS.map((contact) => contact.id)).size, MISSION_CONTACTS.length);
  assert.equal(
    new Set(MISSION_CONTACTS.map((contact) => contact.letter)).size,
    MISSION_CONTACTS.length
  );

  const world = CollisionMap.load();
  for (const contact of MISSION_CONTACTS) {
    assert.equal(missionContact(contact.templateId), contact);
    assert.equal(world.canOccupy(contact.x, contact.y, 24), true);
    assert.equal(world.isRoadAt(contact.x, contact.y), false);
    assert.equal(missionContactNear(contact.x, contact.y), contact);
  }
  for (let first = 0; first < MISSION_CONTACTS.length; first++) {
    for (let second = first + 1; second < MISSION_CONTACTS.length; second++) {
      assert.ok(
        Math.hypot(
          MISSION_CONTACTS[first].x - MISSION_CONTACTS[second].x,
          MISSION_CONTACTS[first].y - MISSION_CONTACTS[second].y
        ) > MISSION_CONTACT_RADIUS * 2
      );
    }
  }
  assert.ok(Math.max(...MISSION_CONTACTS.map((contact) => contact.x)) -
    Math.min(...MISSION_CONTACTS.map((contact) => contact.x)) > 10_000);
  assert.ok(Math.max(...MISSION_CONTACTS.map((contact) => contact.y)) -
    Math.min(...MISSION_CONTACTS.map((contact) => contact.y)) > 7_000);
  assert.equal(
    missionContactNear(
      MISSION_CONTACTS[0].x + MISSION_CONTACT_RADIUS + 1,
      MISSION_CONTACTS[0].y
    ),
    undefined
  );
});
