import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ACTIVE_DISTRICT_ID,
  DISTRICT_CATALOG,
  districtDefinition,
  districtMapAsset,
  districtThreeAsset
} from '../shared/content/district-catalog.ts';

test('district catalog keeps the active runtime district explicit', () => {
  const active = DISTRICT_CATALOG.filter((district) => district.activeRuntime);
  assert.deepEqual(active.map((district) => district.id), [ACTIVE_DISTRICT_ID]);
  assert.equal(districtDefinition('missing').id, ACTIVE_DISTRICT_ID);
});

test('district asset helpers isolate optional converted packages', () => {
  const bil = districtDefinition('bil');
  const wil = districtDefinition('wil');
  assert.equal(districtMapAsset(bil, 'district-map.json'), '/assets/maps/district-map.json');
  assert.equal(
    districtMapAsset(wil, 'district-map.metadata.json'),
    '/assets/districts/wil/maps/district-map.metadata.json'
  );
  assert.equal(districtThreeAsset(wil, 'world.json'), '/assets/districts/wil/maps/three/world.json');
});
