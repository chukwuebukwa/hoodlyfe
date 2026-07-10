import assert from 'node:assert/strict';
import test from 'node:test';
import {cloneAppearance} from '../shared/content/appearance-catalog.ts';
import {
  APPEARANCE_RESULT_MESSAGE,
  APPEARANCE_UPDATE_MESSAGE
} from '../shared/protocol/appearance.ts';
import {
  WARDROBE_OPEN_MESSAGE,
  WARDROBE_REQUEST_MESSAGE,
  WARDROBE_STATE_MESSAGE
} from '../shared/protocol/wardrobe.ts';
import {
  WardrobeClientSession,
  type WardrobeMessageRoom
} from '../src/game/appearance/wardrobe-client-session.ts';

test('wardrobe client session owns private subscriptions, request, submit gate, and acknowledgement', () => {
  const room = new FakeRoom();
  let inventoryUpdates = 0;
  let opens = 0;
  const results: Array<{status: string; outfitName: string}> = [];
  const session = new WardrobeClientSession({
    room,
    onInventory: () => { inventoryUpdates += 1; },
    onOpen: () => { opens += 1; },
    onApplyResult: (status, appearance) => results.push({status, outfitName: appearance.outfitName})
  });

  session.start();
  session.start();
  assert.deepEqual(room.sent.map((message) => message.type), [WARDROBE_REQUEST_MESSAGE]);
  room.emit(WARDROBE_STATE_MESSAGE, {
    ownedItemIds: ['top:jacket', 'top:hoodie', 'not:valid'],
    developmentGrants: false
  });
  assert.equal(inventoryUpdates, 1);
  assert.deepEqual([...session.ownedItems()], ['top:jacket', 'top:hoodie']);

  const appearance = {...cloneAppearance(), outfitName: 'Session Fit', topStyle: 'hoodie' as const};
  assert.equal(session.submit(appearance), true);
  assert.equal(session.submit(appearance), false);
  assert.equal(session.isApplying(), true);
  assert.equal(room.sent.at(-1)?.type, APPEARANCE_UPDATE_MESSAGE);
  room.emit(APPEARANCE_RESULT_MESSAGE, {status: 'applied'});
  assert.equal(session.isApplying(), false);
  assert.deepEqual(results, [{status: 'applied', outfitName: 'Session Fit'}]);

  room.emit(WARDROBE_OPEN_MESSAGE, {serviceId: 'clothing-store'});
  room.emit(WARDROBE_OPEN_MESSAGE, {serviceId: 42});
  assert.equal(opens, 1);
  session.destroy();
  room.emit(WARDROBE_OPEN_MESSAGE, {serviceId: 'clothing-store'});
  assert.equal(opens, 1);
  assert.equal(session.ownedItems().size, 0);
});

class FakeRoom implements WardrobeMessageRoom {
  readonly sent: Array<{type: string; message?: unknown}> = [];
  private readonly handlers = new Map<string, Set<(message: unknown) => void>>();

  onMessage<T>(type: string, callback: (message: T) => void): () => void {
    const handlers = this.handlers.get(type) ?? new Set();
    const handler = callback as (message: unknown) => void;
    handlers.add(handler);
    this.handlers.set(type, handlers);
    return () => handlers.delete(handler);
  }

  send(type: string, message?: unknown): void {
    this.sent.push({type, message});
  }

  emit(type: string, message: unknown): void {
    for (const handler of this.handlers.get(type) ?? []) handler(message);
  }
}
