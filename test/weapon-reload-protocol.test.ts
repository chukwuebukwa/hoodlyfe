import assert from 'node:assert/strict';
import test from 'node:test';
import {WeaponReloadCommandController} from '../server/game/combat/weapon-reload-command-controller.ts';
import {WeaponRuntimeController} from '../server/game/combat/weapon-runtime-controller.ts';
import {DistrictState, PlayerState} from '../server/state.ts';
import {
  WEAPON_RELOAD_PROTOCOL_VERSION,
  validateWeaponReloadRequest
} from '../shared/protocol/weapon-reload.ts';

test('reload requests validate protocol, sequence, and controlled player identity', () => {
  const request = {
    protocolVersion: WEAPON_RELOAD_PROTOCOL_VERSION,
    sequence: 4,
    controlledEntityId: 'player-1'
  };
  assert.equal(validateWeaponReloadRequest(request, 'player-1').accepted, true);
  assert.equal(validateWeaponReloadRequest({...request, sequence: 0}, 'player-1').accepted, false);
  assert.equal(validateWeaponReloadRequest({...request, protocolVersion: 99}, 'player-1').accepted, false);
  assert.equal(validateWeaponReloadRequest(request, 'player-2').accepted, false);
});

test('reload command adapter accepts each request once and preserves authoritative snapshot', () => {
  const state = new DistrictState();
  const player = new PlayerState();
  player.id = 'player-1';
  player.magazinePistol = 3;
  state.players.set(player.id, player);
  const runtime = new WeaponRuntimeController({state, clock: () => ({nowMs: 500})});
  const commands = new WeaponReloadCommandController(runtime);
  const request = {
    protocolVersion: WEAPON_RELOAD_PROTOCOL_VERSION,
    sequence: 1,
    controlledEntityId: player.id
  };

  assert.deepEqual(commands.accept(player.id, request), {
    accepted: true,
    sequence: 1,
    weapon: 'pistol',
    magazine: 3,
    reserve: 108,
    reloadSequence: 1,
    reloadEndsAt: 1600
  });
  assert.equal(commands.accept(player.id, request).reason, 'stale-sequence');
  assert.equal(commands.accept(player.id, {...request, sequence: 9_000}).reason, 'sequence-window-exceeded');
  commands.clearPlayer(player.id);
  assert.equal(commands.accept(player.id, request).accepted, true);
});
