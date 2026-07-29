import assert from 'node:assert/strict';
import test from 'node:test';
import {
  gameWorldDefinition,
  gameWorldIdForRoom
} from '../src/game/runtime/world-catalog.ts';
import {
  projectPhoneActivities,
  projectPhoneActivity
} from '../src/game/ui/phone-activity-policy.ts';

test('world catalog maps freeroam and activities to authoritative rooms', () => {
  const street = gameWorldDefinition('industrial-district');
  assert.equal(street.roomName, 'district');
  assert.equal(street.assetRoot, '/assets');
  assert.equal(street.enableInteriors, true);

  const downtown = gameWorldDefinition('downtown');
  assert.equal(downtown.roomName, 'district-city');
  assert.equal(downtown.assetRoot, '/assets/districts/wil');
  assert.equal(downtown.enableInteriors, false);

  const residential = gameWorldDefinition('residential');
  assert.equal(residential.roomName, 'district-residential');
  assert.equal(residential.assetRoot, '/assets/districts/ste');
  assert.equal(residential.enableInteriors, false);

  const raceway = gameWorldDefinition('raceway');
  assert.equal(raceway.roomName, 'district-race');
  assert.equal(raceway.assetRoot, '/assets/districts/raceway');
  assert.equal(raceway.enableInteriors, false);

  const deathmatch = gameWorldDefinition('deathmatch');
  assert.equal(deathmatch.roomName, 'district-deathmatch');
  assert.equal(deathmatch.assetRoot, '/assets/districts/deathmatch');
  assert.equal(deathmatch.enableInteriors, false);
});

test('canonical room names resolve to phone-travel world identifiers', () => {
  assert.equal(gameWorldIdForRoom(undefined), 'industrial-district');
  assert.equal(gameWorldIdForRoom('district'), 'industrial-district');
  assert.equal(gameWorldIdForRoom('district-city'), 'downtown');
  assert.equal(gameWorldIdForRoom('district-residential'), 'residential');
  assert.equal(gameWorldIdForRoom('district-race'), 'raceway');
  assert.equal(gameWorldIdForRoom('district-deathmatch'), 'deathmatch');
  assert.equal(gameWorldIdForRoom('district-playtest'), undefined);
});

test('phone activity sends street players to the raceway', () => {
  const activities = projectPhoneActivities('industrial-district');
  assert.deepEqual(activities.map((activity) => activity.destination), ['raceway', 'deathmatch']);
  assert.equal(activities[0].actionLabel, 'Enter raceway');
  assert.equal(activities[1].actionLabel, 'Enter deathmatch');
  assert.equal(activities[1].locationLabel, 'Industrial District');
});

test('phone activity lets deathmatch players exit to freeroam', () => {
  const activity = projectPhoneActivity('deathmatch');
  assert.equal(activity.destination, 'industrial-district');
  assert.equal(activity.actionLabel, 'Exit to Freeroam');
  assert.equal(activity.locationLabel, 'Foundry Yard');
});

test('phone activity lets raceway players exit to freeroam', () => {
  const activity = projectPhoneActivity('raceway');
  assert.equal(activity.destination, 'industrial-district');
  assert.equal(activity.actionLabel, 'Exit to Freeroam');
  assert.equal(activity.locationLabel, 'Raceway');
  assert.equal(activity.meta, 'Exit activity');
  assert.equal(activity.title, 'Freeroam');
});
