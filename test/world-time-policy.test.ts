import assert from 'node:assert/strict';
import test from 'node:test';
import {WorldClockController} from '../server/game/world/world-clock-controller.ts';
import {DistrictState} from '../server/state.ts';
import {
  WORLD_CLOCK,
  formatWorldTime,
  lightingAtMinute,
  worldMinuteAt
} from '../shared/content/world-time.ts';
import {
  deriveRoadLightEmitters,
  measureRoadLightCoverage,
  mergeLightEmitters
} from '../src/game/three/three-road-light-policy.ts';
import {STREET_LIGHT_FIXTURES} from '../shared/content/lighting-fixtures.ts';
import {TRAFFIC_SIGNALS} from '../shared/content/traffic-signals.ts';

test('world clock replicates one stable authority anchor and derives cyclic time', () => {
  const state = new DistrictState();
  const controller = new WorldClockController({state, now: () => 10_000});
  controller.initialize();
  controller.initialize();
  assert.deepEqual({
    startedAt: state.worldTimeStartedAt,
    startMinute: state.worldTimeStartMinute,
    rate: state.worldTimeRate
  }, {
    startedAt: 10_000,
    startMinute: WORLD_CLOCK.startMinute,
    rate: WORLD_CLOCK.gameMinutesPerRealSecond
  });
  assert.equal(worldMinuteAt(state, 10_000), 480);
  assert.equal(worldMinuteAt(state, 130_000), 540);
  assert.equal(formatWorldTime(worldMinuteAt(state, 10_000 + 48 * 60_000)), '08:00');
});

test('road lighting derives edge emitters without placing lights in solid road interiors', () => {
  const roads = Array(25).fill(0);
  for (let row = 1; row <= 3; row++) roads[row * 5 + 2] = 1;
  const emitters = deriveRoadLightEmitters({
    width: 5,
    height: 5,
    tilewidth: 64,
    tileheight: 64,
    layers: [{name: 'roads', data: roads}]
  }, 2);
  assert.ok(emitters.length > 0);
  assert.ok(emitters.every((fixture) => fixture.source === 'provisional'));
});

test('generated road lights do not crowd authored fixtures', () => {
  const authored = [{id: 'authored', x: 100, y: 100, source: 'traffic-gantry' as const}];
  const generated = [
    {id: 'near', x: 110, y: 100, source: 'provisional' as const},
    {id: 'far', x: 240, y: 100, source: 'provisional' as const}
  ];
  assert.deepEqual(mergeLightEmitters(authored, generated, 72).map(({id}) => id), ['authored', 'far']);
});

test('procedural lighting guarantees coverage across wide road interiors', () => {
  const roads = Array(81).fill(0);
  for (let row = 2; row <= 6; row++) {
    for (let column = 1; column <= 7; column++) roads[row * 9 + column] = 1;
  }
  const map = {
    width: 9,
    height: 9,
    tilewidth: 64,
    tileheight: 64,
    layers: [{name: 'roads', data: roads}]
  };
  const fixtures = deriveRoadLightEmitters(map, {coverageRadius: 150});
  const coverage = measureRoadLightCoverage(map, fixtures, 150);
  assert.equal(coverage.ratio, 1);
  assert.ok(coverage.maximumDistance <= 150);
  assert.ok(fixtures.some(({x}) => x > 2 * 64 && x < 7 * 64), 'wide roads need interior coverage');
});

test('lighting policy transitions continuously and enables lamps only at night', () => {
  const midnight = lightingAtMinute(0);
  const dawn = lightingAtMinute(6 * 60);
  const noon = lightingAtMinute(12 * 60);
  const dusk = lightingAtMinute(19 * 60);
  assert.equal(midnight.phase, 'night');
  assert.equal(noon.phase, 'day');
  assert.ok(midnight.streetlightIntensity > 0.95);
  assert.equal(noon.streetlightIntensity, 0);
  assert.ok(dawn.sunIntensity > 0 && dawn.sunIntensity < noon.sunIntensity);
  assert.ok(dusk.sunIntensity > 0 && dusk.sunIntensity < noon.sunIntensity);
  assert.notEqual(dawn.skyColor, noon.skyColor);
  assert.equal(formatWorldTime(19 * 60 + 7), '19:07');
});

test('streetlight emission anchors are unique and gantry-backed where declared', () => {
  assert.equal(new Set(STREET_LIGHT_FIXTURES.map(({id}) => id)).size, STREET_LIGHT_FIXTURES.length);
  for (const fixture of STREET_LIGHT_FIXTURES) {
    assert.ok(Number.isFinite(fixture.x) && Number.isFinite(fixture.y));
    if (fixture.source !== 'traffic-gantry') continue;
    assert.ok(TRAFFIC_SIGNALS.some((signal) => (
      Math.hypot(signal.x - fixture.x, signal.y - fixture.y) <= 420
    )), `${fixture.id} must remain tied to an authored signal gantry.`);
  }
});
