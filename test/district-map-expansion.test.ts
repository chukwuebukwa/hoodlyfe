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

test('expansion refuses to transplant authored gameplay onto another source level', () => {
  assert.throws(
    () => expansionDelta(metadata(frame64), {...metadata(frame96), source: 'wil'}),
    /Cannot rebase authored content from bil onto wil/
  );
});

function metadata(frame: DistrictMapFrame): DistrictMapMetadata {
  return {source: 'bil', ...frame};
}
