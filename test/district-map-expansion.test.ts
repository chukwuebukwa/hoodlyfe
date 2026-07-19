import assert from 'node:assert/strict';
import test from 'node:test';
import {
  districtAuthoringOffset,
  districtBounds,
  districtPoint,
  type DistrictMapFrame
} from '../shared/content/district-map-frame.ts';
import {
  expansionDelta,
  rebaseLaneDocument,
  type DistrictMapMetadata,
  type LaneDocument
} from '../scripts/lib/district-map-expansion.ts';
import {INTERIORS} from '../shared/content/interior-catalog.ts';

const frame64: DistrictMapFrame = {
  origin: {x: 96, y: 97},
  size: {width: 64, height: 64},
  tileSize: 64
};
const frame96: DistrictMapFrame = {
  origin: {x: 80, y: 81},
  size: {width: 96, height: 96},
  tileSize: 64
};
const frame256: DistrictMapFrame = {
  origin: {x: 0, y: 0},
  size: {width: 256, height: 256},
  tileSize: 64
};

test('district authoring coordinates follow the active source crop', () => {
  assert.deepEqual(districtAuthoringOffset(frame64), {x: 0, y: 0});
  assert.deepEqual(districtAuthoringOffset(frame96), {x: 1024, y: 1024});
  assert.deepEqual(districtPoint(624, 856, frame96), {x: 1648, y: 1880});
  assert.deepEqual(districtBounds({minX: 0, minY: 64, maxX: 128, maxY: 192}, frame96), {
    minX: 1024,
    minY: 1088,
    maxX: 1152,
    maxY: 1216
  });
});

test('lane rebasing expands and contracts without cumulative drift', () => {
  const metadata64 = metadata(frame64);
  const metadata96 = metadata(frame96);
  const laneDocument: LaneDocument = {
    corridors: [{points: [{x: 224, y: 352}, {x: 224, y: 1696}]}],
    junctions: [{x: 224, y: 416}],
    roadblocks: [{
      x: 3300,
      y: 928,
      vehiclePoses: [{x: 3300, y: 928}],
      stinger: {x: 3240, y: 928, officerPose: {x: 3240, y: 864}}
    }]
  };

  const expansion = expansionDelta(metadata64, metadata96);
  assert.deepEqual(expansion, {x: 1024, y: 1024});
  const expanded = rebaseLaneDocument(laneDocument, expansion.x, expansion.y);
  assert.deepEqual(expanded.corridors[0].points[0], {x: 1248, y: 1376});
  assert.deepEqual(expanded.roadblocks?.[0].stinger.officerPose, {x: 4264, y: 1888});

  const contraction = expansionDelta(metadata96, metadata64);
  const restored = rebaseLaneDocument(expanded, contraction.x, contraction.y);
  assert.deepEqual(restored, laneDocument);
});

test('full-world expansion preserves every authored interior door offset from spawn', () => {
  const spawn96 = districtPoint(2080, 2080, frame96);
  const spawn256 = districtPoint(2080, 2080, frame256);
  const delta = expansionDelta(metadata(frame96), metadata(frame256));
  const authoredDoors = [
    {id: 'mercy-hospital', x: 2632, y: 1944},
    {id: 'ammunation-store', x: 624, y: 856},
    {id: 'threads-store', x: 1952, y: 856},
    {id: 'southside-clinic', x: 3392, y: 1368}
  ];

  assert.deepEqual(delta, {x: 5120, y: 5184});
  assert.deepEqual(spawn256, {x: spawn96.x + delta.x, y: spawn96.y + delta.y});
  for (const authored of authoredDoors) {
    const door96 = districtPoint(authored.x, authored.y, frame96);
    const door256 = districtPoint(authored.x, authored.y, frame256);
    const active = INTERIORS.find(({id}) => id === authored.id)?.exteriorDoor;

    assert.ok(active, `Missing authored interior ${authored.id}.`);
    assert.deepEqual({x: active.x, y: active.y}, door256);
    assert.deepEqual(door256, {x: door96.x + delta.x, y: door96.y + delta.y});
    assert.deepEqual(
      {x: door256.x - spawn256.x, y: door256.y - spawn256.y},
      {x: door96.x - spawn96.x, y: door96.y - spawn96.y},
      `${authored.id} changed its relationship to spawn.`
    );
  }
});

test('expansion refuses to transplant authored gameplay onto another source level', () => {
  assert.throws(
    () => expansionDelta(metadata(frame64), {...metadata(frame96), source: 'wil'}),
    /Cannot rebase authored content from bil onto wil/
  );
});

function metadata(frame: DistrictMapFrame): DistrictMapMetadata {
  return {source: 'bil', ...frame};
}
