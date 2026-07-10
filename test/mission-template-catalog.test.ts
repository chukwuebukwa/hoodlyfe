import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MISSION_TEMPLATE_IDS,
  MISSION_REWARD_POLICIES,
  MISSION_TARGET_MODES,
  cycleMissionTemplate,
  isMissionTemplateId,
  missionCheckpointCount,
  missionTemplate
} from '../shared/content/mission-catalog.ts';

test('mission catalog exposes bounded composable templates with unique objectives', () => {
  assert.deepEqual(MISSION_TEMPLATE_IDS, [
    'boost-and-deliver',
    'getaway-run',
    'checkpoint-rush'
  ]);
  for (const templateId of MISSION_TEMPLATE_IDS) {
    const definition = missionTemplate(templateId);
    assert.equal(definition.id, templateId);
    assert.ok(definition.label.length > 0);
    assert.ok(definition.summary.length > 0);
    assert.ok(definition.baseReward > 0);
    assert.ok(definition.durationMs >= 10_000);
    assert.ok(definition.maximumParticipants >= 1 && definition.maximumParticipants <= 4);
    assert.ok(MISSION_TARGET_MODES.includes(definition.targetMode));
    assert.ok(MISSION_REWARD_POLICIES.includes(definition.rewardPolicy));
    assert.ok(definition.objectives.length >= 1 && definition.objectives.length <= 8);
    assert.equal(new Set(definition.objectives.map((objective) => objective.id)).size, definition.objectives.length);
  }
  assert.equal(missionCheckpointCount('boost-and-deliver'), 0);
  assert.equal(missionCheckpointCount('getaway-run'), 3);
  assert.equal(missionCheckpointCount('checkpoint-rush'), 5);
});

test('mission template selection validates and cycles deterministically', () => {
  assert.equal(isMissionTemplateId('getaway-run'), true);
  assert.equal(isMissionTemplateId('unknown'), false);
  assert.equal(cycleMissionTemplate('boost-and-deliver', 1), 'getaway-run');
  assert.equal(cycleMissionTemplate('getaway-run', 1), 'checkpoint-rush');
  assert.equal(cycleMissionTemplate('checkpoint-rush', 1), 'boost-and-deliver');
  assert.equal(cycleMissionTemplate('boost-and-deliver', -1), 'checkpoint-rush');
});
