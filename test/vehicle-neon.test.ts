import assert from 'node:assert/strict';
import test from 'node:test';
import {
  VEHICLE_NEON_COLORS,
  VEHICLE_NEON_INSTALL_PRICE,
  VEHICLE_NEON_RECOLOR_PRICE,
  nextVehicleNeonColor,
  normalizeVehicleNeonColor,
  vehicleNeonColorHex,
  vehicleNeonUpgradeQuote
} from '../shared/content/vehicle-neon.ts';

test('vehicle neon catalog cycles deterministically with stable pricing and colors', () => {
  assert.equal(normalizeVehicleNeonColor(undefined), 'off');
  assert.equal(normalizeVehicleNeonColor('invalid'), 'off');
  assert.equal(nextVehicleNeonColor('off'), 'cyan');
  assert.equal(nextVehicleNeonColor('cyan'), 'magenta');
  assert.equal(nextVehicleNeonColor(VEHICLE_NEON_COLORS.at(-1)), 'cyan');
  assert.equal(vehicleNeonUpgradeQuote('off'), VEHICLE_NEON_INSTALL_PRICE);
  assert.equal(vehicleNeonUpgradeQuote('violet'), VEHICLE_NEON_RECOLOR_PRICE);
  assert.equal(vehicleNeonColorHex('magenta'), 0xff3ec8);
  assert.equal(vehicleNeonColorHex('off'), 0x000000);
});
