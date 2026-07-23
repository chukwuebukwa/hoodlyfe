import assert from 'node:assert/strict';
import test from 'node:test';
import {districtPoint} from '../shared/content/district-map-frame.ts';
import {
  districtPopulationZoneAt,
  pedestrianKindForProfile,
  populationDayWeightAtMinute,
  populationDensityAdmits,
  populationProfileAt,
  vehicleKindForProfile
} from '../server/game/population/population-zone-profile-policy.ts';

test('district population zones resolve authored landmarks and a safe fallback', () => {
  assert.equal(zoneAt(624, 856), 'north-works');
  assert.equal(zoneAt(1_952, 856), 'north-works');
  assert.equal(zoneAt(2_632, 1_944), 'civic-east');
  assert.equal(zoneAt(1_100, 1_440), 'west-market');
  assert.equal(zoneAt(2_336, 3_488), 'south-freight');
  assert.equal(districtPopulationZoneAt(14_000, 14_000).id, 'district-default');
});

test('time policy smoothly blends day and night profiles', () => {
  assert.equal(populationDayWeightAtMinute(4 * 60), 0);
  assert.equal(populationDayWeightAtMinute(6 * 60), 0.5);
  assert.equal(populationDayWeightAtMinute(12 * 60), 1);
  assert.equal(populationDayWeightAtMinute(19 * 60), 0.5);
  assert.equal(populationDayWeightAtMinute(22 * 60), 0);

  const civicEast = districtPoint(2_632, 1_944);
  const day = populationProfileAt(civicEast.x, civicEast.y, 12 * 60);
  const dusk = populationProfileAt(civicEast.x, civicEast.y, 19 * 60);
  const night = populationProfileAt(civicEast.x, civicEast.y, 22 * 60);
  assert.equal(day.zone.id, 'civic-east');
  assert.ok(day.pedestrianDensity > dusk.pedestrianDensity);
  assert.ok(dusk.pedestrianDensity > night.pedestrianDensity);
  assert.ok(night.policeShare > day.policeShare);
});

test('density and composition selection are deterministic at policy boundaries', () => {
  const civicEast = districtPoint(2_632, 1_944);
  const profile = populationProfileAt(civicEast.x, civicEast.y, 12 * 60);
  assert.equal(populationDensityAdmits(0.6, 0.59), true);
  assert.equal(populationDensityAdmits(0.6, 0.6), false);
  assert.equal(pedestrianKindForProfile(profile, profile.policeShare - 0.001), 'police');
  assert.equal(pedestrianKindForProfile(profile, profile.policeShare), 'civilian');
  assert.equal(vehicleKindForProfile(profile, 0), 'sedan');
  assert.equal(vehicleKindForProfile(profile, 0.99), 'taxi');
  for (let index = 0; index <= 100; index++) {
    assert.ok(['sedan', 'taxi'].includes(vehicleKindForProfile(profile, index / 100)));
  }
});

function zoneAt(x: number, y: number): string {
  const point = districtPoint(x, y);
  return districtPopulationZoneAt(point.x, point.y).id;
}
