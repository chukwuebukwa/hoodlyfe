import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {
  MapRoutePlanner,
  type MapRouteDocument
} from '../scripts/loadtest/map-route-planner.ts';

const document = JSON.parse(readFileSync(
  new URL('../public/assets/maps/district-lanes.json', import.meta.url),
  'utf8'
)) as MapRouteDocument;

test('map load routes cover authored road sectors through connected waypoints', () => {
  const planner = new MapRoutePlanner(document);
  assert.ok(planner.coverageSectorCount >= 12);
  assert.equal(planner.anchorCount, planner.coverageSectorCount);

  const start = planner.anchor(0);
  for (let index = 0; index < planner.anchorCount; index++) {
    const route = planner.routeToAnchor(start.x, start.y, index);
    assert.ok(route.length > 0);
    assert.deepEqual(route.at(-1), planner.anchor(index));
    for (let point = 1; point < route.length; point++) {
      assert.ok(
        Math.hypot(route[point].x - route[point - 1].x, route[point].y - route[point - 1].y) <= 192.001,
        'route waypoint spacing must remain steerable'
      );
    }
  }
});

test('map load coverage ignores positions outside the authored road district', () => {
  const planner = new MapRoutePlanner(document);
  const anchor = planner.anchor(0);
  assert.ok(planner.sectorAt(anchor.x, anchor.y));
  assert.equal(planner.sectorAt(0, 0), undefined);
});
