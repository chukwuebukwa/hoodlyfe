'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { WantedService } = require('../game/server/wanted/WantedService');

test('civilian assault creates wanted level one', () => {
  const wanted = new WantedService({ now: () => 1_000 });
  const state = wanted.recordOffense('player-1', { type: 'assault_civilian' });
  assert.equal(state.score, 1);
  assert.equal(state.level, 1);
  assert.equal(wanted.shouldPoliceTarget('player-1'), true);
});

test('police assault adds two offense points', () => {
  const wanted = new WantedService({ now: () => 1_000 });
  const state = wanted.recordOffense('player-1', { type: 'assault_police' });
  assert.equal(state.score, 2);
  assert.equal(state.level, 1);
});

test('wanted score decays only outside police awareness and combat', () => {
  let now = 1_000;
  const wanted = new WantedService({ now: () => now, decayMs: 100 });
  wanted.recordOffense('player-1', { type: 'kill_police' });

  now = 1_200;
  assert.equal(wanted.tick('player-1', { policeAware: true }).score, 3);
  assert.equal(wanted.tick('player-1', { inCombat: true }).score, 3);
  assert.equal(wanted.tick('player-1').score, 2);
});

test('wanted level never exceeds configured maximum', () => {
  const wanted = new WantedService({ maxLevel: 5 });
  for (let index = 0; index < 10; index += 1) {
    wanted.recordOffense('player-1', { points: 5 });
  }
  assert.equal(wanted.get('player-1').level, 5);
});
