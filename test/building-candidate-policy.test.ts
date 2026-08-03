import assert from 'node:assert/strict';
import test from 'node:test';
import {
  authoredBuildingOverlapping,
  createBuildingAuthorDraft,
  nearestBuildingFacade,
  resolveBuildingCandidateAt,
  type BuildingAuthorGrid
} from '../src/game/building-author/building-candidate-policy.ts';

test('builder gun resolves a connected elevated building and its street facades', () => {
  const grid = gridWithBuilding(16, 16, {minX: 3, minY: 4, maxX: 12, maxY: 8});
  const candidate = resolveBuildingCandidateAt(grid, 5 * 64 + 12, 6 * 64 + 20);

  assert.ok(candidate);
  assert.equal(candidate.valid, true);
  assert.equal(candidate.cells.length, 36);
  assert.deepEqual(candidate.sourceBounds, {minX: 3, minY: 4, maxX: 12, maxY: 8});
  assert.deepEqual(candidate.footprints, [{minX: 3, minY: 4, maxX: 12, maxY: 8}]);
  assert.equal(candidate.floorZ, 2);
  assert.equal(candidate.roofZ, 6);
  assert.deepEqual(
    candidate.facades.map(({side, length}) => ({side, length})),
    [
      {side: 'east', length: 256},
      {side: 'north', length: 576},
      {side: 'south', length: 576},
      {side: 'west', length: 256}
    ]
  );
});

test('builder gun places a vehicle-width garage entrance on the selected facade', () => {
  const grid = gridWithBuilding(16, 16, {minX: 3, minY: 4, maxX: 12, maxY: 8});
  const candidate = resolveBuildingCandidateAt(grid, 6 * 64, 6 * 64);
  assert.ok(candidate);
  const facade = nearestBuildingFacade(candidate, 7.5 * 64, 8 * 64 + 18, 160);
  assert.ok(facade);
  assert.equal(facade.side, 'south');

  const draft = createBuildingAuthorDraft(candidate, 'garage', facade, 7.5 * 64, 8 * 64 + 18);
  assert.equal(draft.status, 'needs-export');
  assert.equal(draft.building.kind, 'garage');
  assert.deepEqual(draft.building.entrance, {side: 'south', x: 7.5, y: 8, width: 2.5});
  assert.deepEqual(draft.building.garageDoor, {
    height: 2.25,
    thickness: 0.1875,
    openRadius: 2.75,
    animationMs: 700,
    holdOpenMs: 1200
  });
  assert.equal(draft.building.floorZ, 2);
  assert.equal(draft.building.roofHeight, 4);
  assert.equal(draft.building.shell.expectedTriangleCount, null);
  assert.equal(draft.building.serviceBindings[0]?.type, 'repair');
  assert.equal(draft.building.serviceBindings[0]?.id, `${draft.building.id}-repair`);
  assert.ok(draft.building.obstacles.some((obstacle) => obstacle.kind === 'wall'));
  const entranceHalfWidth = draft.building.entrance.width / 2;
  assert.equal(draft.building.obstacles.some((obstacle) => (
    obstacle.kind === 'wall' &&
    obstacle.bounds.minY < draft.building.entrance.y &&
    obstacle.bounds.maxY > draft.building.entrance.y &&
    obstacle.bounds.minX < draft.building.entrance.x + entranceHalfWidth &&
    obstacle.bounds.maxX > draft.building.entrance.x - entranceHalfWidth
  )), false);
});

test('builder gun connects adjacent footprint rectangles for continuous interior floors', () => {
  const grid = gridWithBuilding(12, 12, {minX: 2, minY: 2, maxX: 5, maxY: 5});
  const collisions = [...grid.collisions];
  const surfaces = [...grid.surfaces];
  for (let row = 5; row < 7; row++) {
    for (let column = 2; column < 8; column++) {
      collisions[row * grid.width + column] = 1;
      surfaces[row * grid.width + column] = 6;
    }
  }
  const candidate = resolveBuildingCandidateAt({...grid, collisions, surfaces}, 3 * 64, 3 * 64);
  assert.ok(candidate);
  const facade = nearestBuildingFacade(candidate, 2 * 64, 4 * 64, 160);
  assert.ok(facade);
  const draft = createBuildingAuthorDraft(candidate, 'garage', facade, 2 * 64, 4 * 64);
  assert.ok(draft.building.floorConnectors.length > 0);
});

test('builder gun rejects open ground and non-elevated collision components', () => {
  const open = gridWithBuilding(8, 8, {minX: 2, minY: 2, maxX: 4, maxY: 4});
  assert.equal(resolveBuildingCandidateAt(open, 32, 32), undefined);

  const surfaces = [...open.surfaces];
  for (let row = 2; row < 4; row++) {
    for (let column = 2; column < 4; column++) surfaces[row * open.width + column] = 2;
  }
  const flat = resolveBuildingCandidateAt({...open, surfaces}, 2.5 * 64, 2.5 * 64);
  assert.ok(flat);
  assert.equal(flat.valid, false);
  assert.match(flat.reason ?? '', /elevated building roof/);
});

test('builder gun identifies candidates already claimed by an authored building', () => {
  const grid = gridWithBuilding(16, 16, {minX: 3, minY: 4, maxX: 12, maxY: 8});
  const candidate = resolveBuildingCandidateAt(grid, 6 * 64, 6 * 64);
  assert.ok(candidate);

  assert.deepEqual(authoredBuildingOverlapping(candidate, [{
    id: 'existing-garage',
    label: 'Existing Garage',
    footprints: [{minX: 3 * 64, minY: 4 * 64, maxX: 12 * 64, maxY: 8 * 64}]
  }]), {
    id: 'existing-garage',
    label: 'Existing Garage',
    footprints: [{minX: 3 * 64, minY: 4 * 64, maxX: 12 * 64, maxY: 8 * 64}]
  });
});

function gridWithBuilding(
  width: number,
  height: number,
  building: {minX: number; minY: number; maxX: number; maxY: number}
): BuildingAuthorGrid {
  const collisions = new Array<number>(width * height).fill(0);
  const surfaces = new Array<number>(width * height).fill(2);
  for (let row = building.minY; row < building.maxY; row++) {
    for (let column = building.minX; column < building.maxX; column++) {
      const index = row * width + column;
      collisions[index] = 1;
      surfaces[index] = column % 2 ? 6 : 5;
    }
  }
  return {width, height, tileSize: 64, collisions, surfaces};
}
