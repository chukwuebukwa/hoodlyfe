import assert from 'node:assert/strict';
import test from 'node:test';
import {cloneAppearance} from '../shared/content/appearance-catalog.ts';
import {
  DEVELOPMENT_WARDROBE_GRANTS,
  WARDROBE_ITEMS,
  requiredWardrobeItems,
  wardrobeItemForField
} from '../shared/content/wardrobe-catalog.ts';
import {WardrobeInventoryController} from '../server/game/appearance/wardrobe-inventory-controller.ts';

test('wardrobe catalog maps every equip slot to stable unique item IDs', () => {
  assert.equal(new Set(WARDROBE_ITEMS.map((item) => item.id)).size, WARDROBE_ITEMS.length);
  assert.equal(DEVELOPMENT_WARDROBE_GRANTS.length, WARDROBE_ITEMS.length);
  assert.deepEqual(requiredWardrobeItems(cloneAppearance()), [
    'hair:cropped',
    'headwear:none',
    'top:jacket',
    'bottom:jeans',
    'shoes:runners'
  ]);
  assert.equal(wardrobeItemForField('topStyle', 'hoodie'), 'top:hoodie');
  assert.equal(wardrobeItemForField('skinTone', 'bronze'), undefined);
  assert.equal(wardrobeItemForField('topStyle', 'missing'), undefined);
});

test('wardrobe inventories are private, grant development content, and gate equip atomically', () => {
  const wardrobe = new WardrobeInventoryController();
  wardrobe.initialize('all');
  wardrobe.initialize('limited', []);
  const hoodie = {...cloneAppearance(), topStyle: 'hoodie' as const};

  assert.equal(wardrobe.canEquip('all', hoodie), true);
  assert.equal(wardrobe.snapshot('all').developmentGrants, true);
  assert.equal(wardrobe.snapshot('all').ownedItemIds.length, DEVELOPMENT_WARDROBE_GRANTS.length);
  assert.equal(wardrobe.canEquip('limited', cloneAppearance()), true);
  assert.equal(wardrobe.canEquip('limited', hoodie), false);
  assert.deepEqual(wardrobe.missingItems('limited', hoodie), ['top:hoodie']);
  assert.equal(wardrobe.snapshot('limited').ownedItemIds.includes('top:hoodie'), false);
  assert.equal(wardrobe.grant('limited', 'top:hoodie'), true);
  assert.equal(wardrobe.grant('limited', 'top:hoodie'), false);
  assert.equal(wardrobe.canEquip('limited', hoodie), true);

  wardrobe.clearPlayer('limited');
  assert.deepEqual(wardrobe.snapshot('limited').ownedItemIds, []);
  assert.equal(wardrobe.snapshot('all').ownedItemIds.length, DEVELOPMENT_WARDROBE_GRANTS.length);
});
