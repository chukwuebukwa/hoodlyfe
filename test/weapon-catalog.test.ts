import assert from 'node:assert/strict';
import test from 'node:test';
import {
  WEAPON_ORDER,
  WEAPONS,
  isMeleeWeapon
} from '../shared/content/weapon-catalog.ts';
import {AMMUNITION_CAPACITY} from '../shared/content/street-services.ts';

test('weapon catalog exposes complete unique discriminated definitions', () => {
  assert.equal(new Set(WEAPON_ORDER).size, WEAPON_ORDER.length);
  assert.deepEqual([...WEAPON_ORDER].sort(), Object.keys(WEAPONS).sort());
  const ammunitionFields = new Set<string>();

  for (const id of WEAPON_ORDER) {
    const weapon = WEAPONS[id];
    assert.equal(weapon.id, id);
    assert.ok(weapon.name.length > 0);
    assert.ok(weapon.cooldownMs > 0);
    if (weapon.ammunitionField) {
      assert.ok(weapon.ammunitionCapacity > 0);
      assert.equal(ammunitionFields.has(weapon.ammunitionField), false);
      ammunitionFields.add(weapon.ammunitionField);
      assert.equal(AMMUNITION_CAPACITY[weapon.ammunitionField], weapon.ammunitionCapacity);
    }
    assert.ok(weapon.presentation.assetId.length > 0);
    assert.ok(weapon.presentation.heldWidth > 0);
    assert.ok(weapon.presentation.heldHeight > 0);
    if (weapon.fireMode === 'bullet') {
      assert.ok(weapon.ammunitionField);
      assert.ok(weapon.damage > 0);
      assert.ok(weapon.projectileSpeed > 0);
      assert.ok(weapon.lifetimeMs > 0);
      assert.ok(weapon.pellets > 0);
      assert.ok(weapon.magazineSize > 0);
      assert.ok(weapon.reloadMs > 0);
    } else if (weapon.fireMode === 'rocket') {
      assert.equal(weapon.ammunitionField, 'ammoRocket');
      assert.ok(weapon.projectileSpeed > 0);
      assert.ok(weapon.lifetimeMs > 0);
      assert.equal(weapon.passengerAllowed, false);
      assert.equal(weapon.magazineSize, 1);
      assert.ok(weapon.reloadMs > 0);
    } else if (weapon.fireMode === 'thrown') {
      assert.equal(
        weapon.ammunitionField,
        weapon.id === 'molotov' ? 'ammoMolotov' : 'ammoGrenade'
      );
      assert.ok(weapon.fuseMs > 0);
      assert.equal(weapon.impactTriggered, weapon.id === 'molotov');
    } else {
      assert.equal(weapon.ammunitionField, null);
      assert.equal(isMeleeWeapon(weapon), true);
      assert.ok(weapon.comboResetMs >= weapon.cooldownMs);
      assert.ok(weapon.strikes.length > 0);
      for (const strike of weapon.strikes) {
        assert.ok(strike.impactMs > 0 && strike.impactMs < strike.durationMs);
        assert.ok(strike.damage > 0);
        assert.ok(strike.range > 0);
        assert.ok(strike.halfArcRadians > 0 && strike.halfArcRadians < Math.PI);
        assert.ok(strike.maxPedTargets > 0);
        assert.ok(strike.vehicleDamage >= 0);
        assert.ok(strike.maxVehicleTargets >= 0);
      }
    }
  }
});
