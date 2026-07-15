import assert from 'node:assert/strict';
import test from 'node:test';
import {isDevelopmentQaGuest} from '../components/development-qa-session.ts';

test('development QA guest activates only for the explicit query flag outside production', () => {
  assert.equal(isDevelopmentQaGuest('?renderer=three&qa=1', 'development'), true);
  assert.equal(isDevelopmentQaGuest('?renderer=three&qa=0', 'development'), false);
  assert.equal(isDevelopmentQaGuest('?renderer=three&qa=1', 'production'), false);
});
