import assert from 'node:assert/strict';
import test from 'node:test';
import {
  districtPopulationZoneAt,
  pedestrianKindForProfile,
  populationDayWeightAtMinute,
  populationDensityAdmits,
  populationProfileAt,
  vehicleKindForProfile
} from '../server/game/population/population-zone-profile-policy.ts';

test('district population zones resolve authored landmarks and a safe fallback', () => {
  assert.equal(districtPopulationZoneAt(624, 856).id, 'north-works');
  assert.equal(districtPopulationZoneAt(1_952, 856).id, 'north-works');
  assert.equal(districtPopulationZoneAt(2_632, 1_944).id, 'civic-east');
  assert.equal(districtPopulationZoneAt(1_100, 1_440).id, 'west-market');
  assert.equal(districtPopulationZoneAt(2_336, 3_488).id, 'south-freight');
  assert.equal(districtPopulationZoneAt(8_000, 8_000).id, 'district-default');
});

test('time policy smoothly blends day and night profiles', () => {
  assert.equal(populationDayWeightAtMinute(4 * 60), 0);
  assert.equal(populationDayWeightAtMinute(6 * 60), 0.5);
  assert.equal(populationDayWeightAtMinute(12 * 60), 1);
  assert.equal(populationDayWeightAtMinute(19 * 60), 0.5);
  assert.equal(populationDayWeightAtMinute(22 * 60), 0);

  const day = populationProfileAt(2_632, 1_944, 12 * 60);
  const dusk = populationProfileAt(2_632, 1_944, 19 * 60);
  const night = populationProfileAt(2_632, 1_944, 22 * 60);
  assert.equal(day.zone.id, 'civic-east');
  assert.ok(day.pedestrianDensity > dusk.pedestrianDensity);
  assert.ok(dusk.pedestrianDensity > night.pedestrianDensity);
  assert.ok(night.policeShare > day.policeShare);
});

test('density and composition selection are deterministic at policy boundaries', () => {
  const profile = populationProfileAt(2_632, 1_944, 12 * 60);
  assert.equal(populationDensityAdmits(0.6, 0.59), true);
  assert.equal(populationDensityAdmits(0.6, 0.6), false);
  assert.equal(pedestrianKindForProfile(profile, profile.policeShare - 0.001), 'police');
  assert.equal(pedestrianKindForProfile(profile, profile.policeShare), 'civilian');
  assert.equal(vehicleKindForProfile(profile, 0), 'sedan');
  assert.equal(vehicleKindForProfile(profile, 0.99), 's15');
});
