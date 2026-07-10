import assert from 'node:assert/strict';
import test from 'node:test';
import {
  VEHICLE_KINDS,
  vehicleDefinition
} from '../shared/content/vehicle-catalog.ts';

test('vehicle catalog exposes complete, distinct, bounded model definitions', () => {
  assert.deepEqual(VEHICLE_KINDS, ['sedan', 'police', 'taxi']);
  const definitions = VEHICLE_KINDS.map(vehicleDefinition);
  for (const definition of definitions) {
    assert.equal(definition.id, VEHICLE_KINDS[definition.presentation.frame]);
    assert.ok(definition.seats >= 1 && definition.seats <= 4);
    assert.ok(definition.radius > 0);
    assert.ok(definition.maxHealth > 0);
    assert.ok(definition.mass > 0);
    assert.ok(definition.handling.maximumForwardSpeed > definition.traffic.cruiseSpeed);
    assert.ok(definition.traffic.brakeDeceleration > definition.traffic.acceleration);
  }
  assert.ok(vehicleDefinition('police').maxHealth > vehicleDefinition('taxi').maxHealth);
  assert.ok(
    vehicleDefinition('police').handling.maximumForwardSpeed >
    vehicleDefinition('taxi').handling.maximumForwardSpeed
  );
  assert.equal(vehicleDefinition('unknown'), vehicleDefinition('sedan'));
});
