import assert from 'node:assert/strict';
import test from 'node:test';
import type {NetworkVehicle} from '../src/game/types.ts';
import {
  emergencyLightPresentation,
  vehicleLightPresentation,
  vehicleNeonPresentation
} from '../src/game/rendering/vehicle-light-render-policy.ts';

function vehicle(overrides: Partial<NetworkVehicle> = {}): NetworkVehicle {
  return {
    id: 'car', kind: 'sedan', x: 0, y: 0, angle: 0, speed: 20,
    health: 1000, maxHealth: 1000, engineDamage: 0, tyreDamageMask: 0,
    damageFront: 0, damageRear: 0, damageLeft: 0, damageRight: 0,
    onFire: false, fireStartedAt: 0, destroyed: false, respawnAt: 0,
    driverId: 'driver', traffic: false, hijackBy: '', ...overrides
  };
}

test('vehicle lamps require darkness, proximity, and an operating vehicle', () => {
  assert.equal(vehicleLightPresentation(vehicle(), 0, true).active, false);
  assert.equal(vehicleLightPresentation(vehicle(), 1, false).active, false);
  assert.equal(vehicleLightPresentation(vehicle({driverId: '', traffic: false}), 1, true).active, false);
  assert.equal(vehicleLightPresentation(vehicle({destroyed: true}), 1, true).active, false);
  assert.equal(vehicleLightPresentation(vehicle(), 1, true).active, true);
});

test('front and rear damage fade their lamps while reverse selects white rear lamps', () => {
  const damaged = vehicleLightPresentation(vehicle({damageFront: 1, damageRear: 0.5}), 1, true);
  assert.ok(damaged.frontOpacity > 0 && damaged.frontOpacity < 0.2);
  assert.ok(damaged.rearOpacity > 0 && damaged.rearOpacity < 0.2);
  assert.equal(damaged.rearColor, 0xff1f2f);
  assert.equal(vehicleLightPresentation(vehicle({speed: -20}), 1, true).rearColor, 0xf4f0d8);
});

test('police emergency lamps alternate only for an operable active siren', () => {
  const cruiser = vehicle({kind: 'police', siren: true});
  assert.deepEqual(emergencyLightPresentation(cruiser, 0), {
    active: true,
    redOpacity: 0.92,
    blueOpacity: 0.16
  });
  assert.deepEqual(emergencyLightPresentation(cruiser, 120), {
    active: true,
    redOpacity: 0.16,
    blueOpacity: 0.92
  });
  assert.equal(emergencyLightPresentation(vehicle({kind: 'police'}), 0).active, false);
  assert.equal(emergencyLightPresentation(vehicle({kind: 'sedan', siren: true}), 0).active, false);
  assert.equal(emergencyLightPresentation(vehicle({kind: 'police', siren: true, destroyed: true}), 0).active, false);
});

test('neon glow follows replicated color, proximity, operation, and darkness', () => {
  assert.equal(vehicleNeonPresentation(vehicle(), 1, true).active, false);
  const cyan = vehicleNeonPresentation(vehicle({neonColor: 'cyan'}), 1, true);
  assert.equal(cyan.active, true);
  assert.equal(cyan.color, 0x39e7ff);
  assert.ok(Math.abs(cyan.opacity - 0.76) < 0.0001);
  assert.equal(vehicleNeonPresentation(vehicle({neonColor: 'magenta'}), 0, true).opacity, 0.34);
  assert.equal(vehicleNeonPresentation(vehicle({neonColor: 'lime'}), 1, false).active, false);
  assert.equal(vehicleNeonPresentation(
    vehicle({neonColor: 'violet', driverId: '', traffic: false}),
    1,
    true
  ).active, false);
  assert.equal(vehicleNeonPresentation(vehicle({neonColor: 'amber', destroyed: true}), 1, true).active, false);
});
