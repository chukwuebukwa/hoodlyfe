import assert from 'node:assert/strict';
import test from 'node:test';
import {
  VEHICLE_KINDS,
  vehicleDefinition
} from '../shared/content/vehicle-catalog.ts';

test('vehicle catalog exposes complete, distinct, bounded model definitions', () => {
  assert.deepEqual(VEHICLE_KINDS, ['sedan', 'police', 'taxi', 'r33', 's15', 'suv']);
  const definitions = VEHICLE_KINDS.map(vehicleDefinition);
  for (const definition of definitions) {
    assert.equal(definition.id, VEHICLE_KINDS[definition.presentation.frame]);
    assert.ok(definition.seats >= 1 && definition.seats <= 4);
    assert.ok(definition.radius > 0);
    assert.ok(definition.maxHealth > 0);
    assert.ok(definition.mass > 0);
    assert.ok(definition.collision.length > definition.collision.width);
    assert.ok(definition.collision.width > 0);
    assert.ok(definition.handling.maximumForwardSpeed > definition.traffic.cruiseSpeed);
    assert.ok(definition.traffic.brakeDeceleration > definition.traffic.acceleration);
  }
  assert.ok(vehicleDefinition('police').maxHealth > vehicleDefinition('taxi').maxHealth);
  assert.ok(
    vehicleDefinition('police').handling.maximumForwardSpeed >
    vehicleDefinition('taxi').handling.maximumForwardSpeed
  );
  assert.equal(vehicleDefinition('r33').seats, 2);
  assert.equal(vehicleDefinition('s15').seats, 2);
  assert.ok(
    vehicleDefinition('s15').handling.maximumForwardSpeed >
    vehicleDefinition('sedan').handling.maximumForwardSpeed
  );
  assert.ok(vehicleDefinition('suv').mass > vehicleDefinition('sedan').mass);
  assert.equal(vehicleDefinition('suv').seats, 4);
  assert.equal(vehicleDefinition('unknown'), vehicleDefinition('sedan'));
});
