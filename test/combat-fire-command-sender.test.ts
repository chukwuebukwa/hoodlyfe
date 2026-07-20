import assert from 'node:assert/strict';
import test from 'node:test';
import {
  COMBAT_FIRE_MESSAGE,
  COMBAT_PROTOCOL_VERSION,
  type CombatFireReceipt
} from '../shared/protocol/combat-fire.ts';
import {CombatFireCommandSender} from '../src/game/network/combat-fire-command-sender.ts';

test('authoritative fire commands preserve rewind metadata without local prediction', () => {
  const sent: Array<{type: string; message?: unknown}> = [];
  const sender = new CombatFireCommandSender({
    room: {send: (type: string, message?: unknown) => sent.push({type, message})} as never,
    player: () => ({id: 'player-1', alive: true, spaceId: 'street', weapon: 'shotgun'}) as never,
    estimatedServerTimeMs: () => 1_250,
    combatRewindEnabled: () => true
  });

  sender.send(Math.PI / 2);

  assert.equal(sent[0]?.type, COMBAT_FIRE_MESSAGE);
  assert.deepEqual(sent[0]?.message, {
    protocolVersion: COMBAT_PROTOCOL_VERSION,
    sequence: 1,
    clientSampleTimeMs: 1_250,
    controlledEntityId: 'player-1',
    aimAngle: Math.PI / 2
  });
});

test('fire falls back to the legacy authority command when rewind is unavailable', () => {
  const sent: Array<{type: string; message?: unknown}> = [];
  const sender = new CombatFireCommandSender({
    room: {send: (type: string, message?: unknown) => sent.push({type, message})} as never,
    player: () => ({id: 'player-1', alive: true, spaceId: 'street', weapon: 'pistol'}) as never,
    estimatedServerTimeMs: () => 0,
    combatRewindEnabled: () => false
  });

  sender.send(0);

  assert.deepEqual(sent, [{type: 'shoot', message: undefined}]);
});

test('fire sender routes matching authoritative receipts to presentation reconciliation', () => {
  let receive: ((message: CombatFireReceipt) => void) | undefined;
  let removed = false;
  const receipts: CombatFireReceipt[] = [];
  const sender = new CombatFireCommandSender({
    room: {
      send() {},
      onMessage(type: string, callback: (message: CombatFireReceipt) => void) {
        assert.equal(type, 'combat.fire.receipt');
        receive = callback;
        return () => { removed = true; };
      }
    } as never,
    player: () => undefined,
    estimatedServerTimeMs: () => 0,
    combatRewindEnabled: () => true,
    onReceipt: (receipt) => receipts.push(receipt)
  });
  receive?.({protocolVersion: COMBAT_PROTOCOL_VERSION + 1, sequence: 1, accepted: false});
  receive?.({protocolVersion: COMBAT_PROTOCOL_VERSION, sequence: 1, accepted: true, magazine: 11});
  assert.deepEqual(receipts, [
    {protocolVersion: COMBAT_PROTOCOL_VERSION, sequence: 1, accepted: true, magazine: 11}
  ]);
  sender.destroy();
  assert.equal(removed, true);
});
