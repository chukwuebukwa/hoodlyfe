import assert from 'node:assert/strict';
import test from 'node:test';
import type {InteractionActorType, InteractionSnapshot} from '../shared/protocol/interaction-islands.ts';
import {
  DESKTOP_INTERACTION_ISLAND_BUDGET,
  INTERACTION_CONTACT_RETENTION_TICKS,
  InteractionIslandSelector,
  MOBILE_INTERACTION_ISLAND_BUDGET
} from '../src/game/network/interaction-island-selector.ts';

test('selector admits root contacts before server-ranked bodies within weighted budget', () => {
  const selector = new InteractionIslandSelector(6);
  const value = selector.select(snapshot(1, [
    body('player:p1', 'player'),
    body('vehicle:ranked', 'vehicle'),
    body('player:contact', 'player'),
    body('prop:overflow', 'prop')
  ], [['player:contact', 'player:p1']]))!;
  assert.deepEqual(value.bodyKeys, ['player:p1', 'player:contact', 'vehicle:ranked']);
  assert.deepEqual(value.members.map(({reason}) => reason), ['root', 'current-contact', 'server-ranked']);
  assert.equal(value.weightedPoints, 6);
  assert.deepEqual(value.overflowBodyKeys, ['prop:overflow']);
});

test('selector retains recent contacts for six ticks and then returns to server order', () => {
  const selector = new InteractionIslandSelector(DESKTOP_INTERACTION_ISLAND_BUDGET);
  const bodies = [
    body('player:p1', 'player'),
    body('vehicle:ranked', 'vehicle'),
    body('player:contact', 'player')
  ];
  selector.select(snapshot(10, bodies, [['player:contact', 'player:p1']]));
  const retained = selector.select(snapshot(10 + INTERACTION_CONTACT_RETENTION_TICKS, bodies))!;
  assert.deepEqual(retained.bodyKeys, ['player:p1', 'player:contact', 'vehicle:ranked']);
  assert.equal(retained.members[1].reason, 'contact-retained');
  const expired = selector.select(snapshot(11 + INTERACTION_CONTACT_RETENTION_TICKS, bodies))!;
  assert.deepEqual(expired.bodyKeys, ['player:p1', 'vehicle:ranked', 'player:contact']);
});

test('selector applies mobile budget and resets hysteresis across control revisions', () => {
  const selector = new InteractionIslandSelector(MOBILE_INTERACTION_ISLAND_BUDGET);
  const bodies = [body('vehicle:root', 'vehicle')];
  for (let index = 0; index < 6; index++) bodies.push(body(`vehicle:${index}`, 'vehicle'));
  const initial = selector.select(snapshot(1, bodies, [], {
    rootBodyKey: 'vehicle:root', rootMode: 'driver'
  }))!;
  assert.equal(initial.weightedPoints, 20);
  assert.equal(initial.overflowBodyKeys.length, 2);
  const changed = selector.select(snapshot(2, bodies, [], {
    rootBodyKey: 'vehicle:root', rootMode: 'driver', controlRevision: 2
  }))!;
  assert.equal(changed.resetCount, 1);
});

function snapshot(
  serverTick: number,
  bodies: ReturnType<typeof body>[],
  contacts: Array<[string, string]> = [],
  overrides: Partial<InteractionSnapshot> = {}
): InteractionSnapshot {
  const rootBodyKey = overrides.rootBodyKey ?? 'player:p1';
  const normalizedContacts = contacts.map(([left, right]) => left < right
    ? {firstBodyKey: left, secondBodyKey: right}
    : {firstBodyKey: right, secondBodyKey: left});
  return {
    protocolVersion: 7,
    serverTick,
    baselineTick: serverTick,
    serverTimeMs: serverTick * 16,
    worldCollisionRevision: 2,
    streamRevision: 1,
    surfaceRevision: 1,
    controlRevision: 1,
    rootLifecycleRevision: bodies.find(({key}) => key === rootBodyKey)?.lifecycleRevision ?? 1,
    rootBodyKey,
    rootMode: 'on-foot',
    acknowledgedLocalInputSequence: 0,
    confirmedEventsThrough: serverTick,
    bodies,
    intents: [],
    contacts: normalizedContacts,
    ...overrides
  };
}

function body(key: string, actorType: InteractionActorType) {
  return {
    key,
    actorType,
    entityId: key,
    spaceId: 'street',
    surfaceId: 'street:ground',
    shapeKey: actorType,
    shapeRevision: 1,
    lifecycleRevision: 1,
    priority: 'ambient' as const,
    x: 0,
    y: 0,
    rotation: 0,
    linvelX: 0,
    linvelY: 0,
    angvel: 0
  };
}
