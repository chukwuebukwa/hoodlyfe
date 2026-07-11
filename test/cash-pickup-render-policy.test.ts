import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cashPickupLabel,
  cashPickupMinimapPoints
} from '../src/game/rendering/cash-pickup-render-policy.ts';

test('cash pickup presentation projects stable labels and minimap points', () => {
  assert.equal(cashPickupLabel(199.9), '$199');
  assert.deepEqual(cashPickupMinimapPoints([
    {id: 'cash:1', ownerId: 'victim', x: 10, y: 20, amount: 75, availableAt: 0, expiresAt: 100},
    {id: 'cash:0', ownerId: 'victim', x: 0, y: 0, amount: 0, availableAt: 0, expiresAt: 100}
  ]), [{id: 'cash:1', kind: 'cash', x: 10, y: 20}]);
});
