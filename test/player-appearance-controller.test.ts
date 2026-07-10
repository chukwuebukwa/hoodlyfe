import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_APPEARANCE,
  cloneAppearance
} from '../shared/content/appearance-catalog.ts';
import {PlayerAppearanceController} from '../server/game/players/player-appearance-controller.ts';
import {DistrictState, PlayerState} from '../server/state.ts';

test('appearance controller defaults invalid join data and applies valid public state', () => {
  const state = new DistrictState();
  const player = new PlayerState();
  player.id = 'driver';
  state.players.set(player.id, player);
  let nowMs = 100;
  const controller = new PlayerAppearanceController({state, clock: () => ({nowMs})});

  assert.deepEqual(controller.initialize(player, {bodyType: 'invalid'}), DEFAULT_APPEARANCE);
  const update = {...cloneAppearance(), outfitName: 'Night Run', topColor: 'red' as const};
  assert.equal(controller.update(player.id, update), 'applied');
  assert.equal(player.appearance.outfitName, 'Night Run');
  assert.equal(player.appearance.topColor, 'red');
  assert.equal(player.health, 100);
  assert.equal(player.weapon, 'pistol');

  assert.equal(controller.update(player.id, {...update, topColor: 'blue'}), 'rate-limited');
  assert.equal(player.appearance.topColor, 'red');
  nowMs += 150;
  assert.equal(controller.update(player.id, {...update, topColor: 'blue'}), 'applied');
  assert.equal(player.appearance.topColor, 'blue');
  controller.clearPlayer(player.id);
});

test('appearance controller rejects hostile IDs without partial mutation', () => {
  const state = new DistrictState();
  const player = new PlayerState();
  player.id = 'driver';
  state.players.set(player.id, player);
  const controller = new PlayerAppearanceController({state, clock: () => ({nowMs: 100})});
  controller.initialize(player, cloneAppearance());
  const before = player.appearance.topColor;
  assert.equal(controller.update(player.id, {...cloneAppearance(), topColor: 'javascript:test'}), 'invalid');
  assert.equal(player.appearance.topColor, before);
  assert.equal(controller.update('missing', cloneAppearance()), 'missing');
});
