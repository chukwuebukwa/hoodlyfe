import assert from 'node:assert/strict';
import test from 'node:test';
import {
  STOREFRONT_PROTOCOL_VERSION,
  isStorefrontProductId,
  isStorefrontPurchaseMessage
} from '../shared/protocol/storefront.ts';

test('storefront purchase protocol accepts explicit repair and neon products', () => {
  for (const productId of ['repair.full', 'neon.off', 'neon.cyan', 'neon.white']) {
    assert.equal(isStorefrontProductId(productId), true);
    assert.equal(isStorefrontPurchaseMessage({
      protocolVersion: STOREFRONT_PROTOCOL_VERSION,
      sequence: 1,
      storeId: 'repair-garage',
      vehicleId: 'vehicle-1',
      productId
    }), true);
  }
});

test('storefront purchase protocol rejects malformed and unknown requests', () => {
  assert.equal(isStorefrontProductId('neon.red'), false);
  assert.equal(isStorefrontPurchaseMessage(undefined), false);
  assert.equal(isStorefrontPurchaseMessage({
    protocolVersion: 99,
    sequence: 1,
    storeId: 'repair-garage',
    vehicleId: 'vehicle-1',
    productId: 'repair.full'
  }), false);
  assert.equal(isStorefrontPurchaseMessage({
    protocolVersion: STOREFRONT_PROTOCOL_VERSION,
    sequence: 0,
    storeId: 'repair-garage',
    vehicleId: 'vehicle-1',
    productId: 'repair.full'
  }), false);
  assert.equal(isStorefrontPurchaseMessage({
    protocolVersion: STOREFRONT_PROTOCOL_VERSION,
    sequence: 1,
    storeId: 'repair-garage',
    vehicleId: 'vehicle-1',
    productId: 'neon.red'
  }), false);
});
