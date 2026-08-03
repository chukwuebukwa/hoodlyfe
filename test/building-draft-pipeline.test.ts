import assert from 'node:assert/strict';
import test from 'node:test';
import rawManifest from '../shared/content/buildings/buildings.json';
import {
  countDraftRoofTriangles,
  promoteBuildingDraft
} from '../scripts/building-draft-pipeline.ts';

test('building draft pipeline derives the exporter triangle count from chunk geometry', async () => {
  const source = rawManifest.buildings.find((building) => building.id === 'eastside-quick-mart');
  assert.ok(source);
  const building = structuredClone(source) as unknown as {
    shell: {expectedTriangleCount: number | null};
  } & Record<string, unknown>;
  building.shell.expectedTriangleCount = null;

  assert.equal(await countDraftRoofTriangles(building as never), source.shell.expectedTriangleCount);
});

test('building draft pipeline validates and intentionally replaces an authored candidate', () => {
  const source = rawManifest.buildings.find((building) => building.id === 'eastside-quick-mart');
  assert.ok(source);
  const building = structuredClone(source) as unknown as {
    shell: {expectedTriangleCount: number | null};
  } & Record<string, unknown>;
  building.shell.expectedTriangleCount = null;
  const draft = {
    version: 1,
    generatedBy: 'nock0-builder-gun',
    status: 'needs-export',
    candidateId: 'building-163-133-test',
    building
  };

  assert.throws(
    () => promoteBuildingDraft(draft, rawManifest, source.shell.expectedTriangleCount),
    /Use --replace intentionally/
  );
  const promoted = promoteBuildingDraft(
    draft,
    rawManifest,
    source.shell.expectedTriangleCount,
    {id: 'eastside-quick-mart', label: 'Eastside Quick Mart', replace: true}
  );
  assert.equal(promoted.buildings.length, rawManifest.buildings.length);
  assert.equal(
    promoted.buildings.find((candidate) => candidate.id === 'eastside-quick-mart')?.shell.expectedTriangleCount,
    source.shell.expectedTriangleCount
  );
});
