import assert from 'node:assert/strict';
import test from 'node:test';
import {
  gameWorldDefinition,
  gameWorldIdForRoom
} from '../src/game/runtime/world-catalog.ts';
import {projectPhoneActivity} from '../src/game/ui/phone-activity-policy.ts';

test('world catalog maps the street and raceway to their authoritative rooms', () => {
  const street = gameWorldDefinition('industrial-district');
  assert.equal(street.roomName, 'district');
  assert.equal(street.assetRoot, '/assets');
  assert.equal(street.enableInteriors, true);

  const raceway = gameWorldDefinition('raceway');
  assert.equal(raceway.roomName, 'district-race');
  assert.equal(raceway.assetRoot, '/assets/districts/raceway');
  assert.equal(raceway.enableInteriors, false);
});

test('canonical room names resolve to phone-travel world identifiers', () => {
  assert.equal(gameWorldIdForRoom(undefined), 'industrial-district');
  assert.equal(gameWorldIdForRoom('district'), 'industrial-district');
  assert.equal(gameWorldIdForRoom('district-race'), 'raceway');
  assert.equal(gameWorldIdForRoom('district-playtest'), undefined);
});

test('phone activity sends street players to the raceway', () => {
  const activity = projectPhoneActivity('industrial-district');
  assert.equal(activity.destination, 'raceway');
  assert.equal(activity.actionLabel, 'Enter raceway');
  assert.equal(activity.locationLabel, 'Industrial District');
});

test('phone activity provides a return trip from the raceway', () => {
  const activity = projectPhoneActivity('raceway');
  assert.equal(activity.destination, 'industrial-district');
  assert.equal(activity.actionLabel, 'Return to city');
  assert.equal(activity.locationLabel, 'Nock0 Raceway');
});
