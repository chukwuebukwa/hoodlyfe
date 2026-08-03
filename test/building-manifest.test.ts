import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {
  BUILDING_MANIFEST,
  parseBuildingManifest
} from '../shared/content/building-manifest.ts';
import {SEAMLESS_INTERIORS} from '../shared/content/seamless-interior-catalog.ts';

test('building manifest is valid and owns every exported roof group', () => {
  assert.equal(BUILDING_MANIFEST.version, 1);
  assert.equal(BUILDING_MANIFEST.sourceLevel, 'bil');
  assert.equal(BUILDING_MANIFEST.blockSize, 64);
  assert.deepEqual(
    BUILDING_MANIFEST.buildings.map(({id}) => id),
    [
      'mercy-hospital',
      'ammunation-store',
      'threads-store',
      'southside-clinic',
      'quick-stop-market',
      'nock-auto-garage',
      'eastside-quick-mart',
      'westside-auto-garage'
    ]
  );
});

test('Nock Auto compiles a vehicle-width garage and repair service', () => {
  const source = BUILDING_MANIFEST.buildings.find(({id}) => id === 'nock-auto-garage');
  const runtime = SEAMLESS_INTERIORS.find(({id}) => id === 'nock-auto-garage');
  assert.ok(source);
  assert.ok(runtime);
  assert.equal(source.kind, 'garage');
  assert.equal(source.shell.expectedTriangleCount, 250);
  assert.deepEqual(runtime.bounds, {minX: 9_600, minY: 8_512, maxX: 10_176, maxY: 8_768});
  assert.deepEqual(runtime.entrance, {side: 'south', x: 9_888, y: 8_768, width: 160});
  assert.deepEqual(runtime.garageDoor, {
    id: 'nock-auto-garage',
    side: 'south',
    x: 9_888,
    y: 8_768,
    width: 160,
    height: 144,
    thickness: 12,
    openRadius: 176,
    animationMs: 700,
    holdOpenMs: 1200,
    minX: 9_808,
    minY: 8_762,
    maxX: 9_968,
    maxY: 8_774
  });
  assert.deepEqual(runtime.serviceBindings, [{
    id: 'repair-garage',
    type: 'repair',
    label: 'Repair Garage',
    x: 9_888,
    y: 8_688
  }]);
  assert.deepEqual(runtime.signage, {exterior: 'NOCK AUTO', service: 'REPAIR BAYS'});
});

test('Quick Stop runtime geometry is compiled from source block units', () => {
  const source = BUILDING_MANIFEST.buildings.find(({id}) => id === 'quick-stop-market');
  const runtime = SEAMLESS_INTERIORS.find(({id}) => id === 'quick-stop-market');
  assert.ok(source);
  assert.ok(runtime);
  assert.equal(source.mode, 'seamless-cutaway');
  assert.equal(source.kind, 'store');
  assert.deepEqual(runtime.bounds, {minX: 12_480, minY: 7_872, maxX: 12_864, maxY: 8_320});
  assert.deepEqual(runtime.entrance, {side: 'south', x: 12_768, y: 8_320, width: 56});
  assert.equal(runtime.floorZ, 128);
  assert.equal(runtime.roofTriangleCount, source.shell.expectedTriangleCount);
  assert.deepEqual(runtime.signage, {exterior: 'QUICK STOP', service: 'CHECKOUT'});
  assert.equal(runtime.obstacles.length, 15);
});

test('Eastside Quick Mart compiles the Builder Gun draft into a sealed storefront', () => {
  const source = BUILDING_MANIFEST.buildings.find(({id}) => id === 'eastside-quick-mart');
  const runtime = SEAMLESS_INTERIORS.find(({id}) => id === 'eastside-quick-mart');
  assert.ok(source);
  assert.ok(runtime);
  assert.equal(source.kind, 'store');
  assert.deepEqual(runtime.bounds, {minX: 10_432, minY: 8_512, maxX: 10_752, maxY: 8_768});
  assert.deepEqual(runtime.entrance, {side: 'south', x: 10_696, y: 8_768, width: 56});
  assert.deepEqual(runtime.serviceBindings, [{
    id: 'eastside-quick-mart-checkout',
    type: 'shop',
    label: 'Quick Mart Checkout',
    x: 10_592,
    y: 8_560
  }]);
  assert.equal(runtime.obstacles.length, 7);
});

test('Westside Auto compiles an L-shaped Builder Gun draft into a usable garage', () => {
  const source = BUILDING_MANIFEST.buildings.find(({id}) => id === 'westside-auto-garage');
  const runtime = SEAMLESS_INTERIORS.find(({id}) => id === 'westside-auto-garage');
  assert.ok(source);
  assert.ok(runtime);
  assert.equal(source.kind, 'garage');
  assert.deepEqual(runtime.bounds, {minX: 9_088, minY: 7_808, maxX: 9_536, maxY: 8_128});
  assert.deepEqual(runtime.entrance, {side: 'west', x: 9_088, y: 7_968, width: 160});
  assert.deepEqual(runtime.garageDoor, {
    id: 'westside-auto-garage',
    side: 'west',
    x: 9_088,
    y: 7_968,
    width: 160,
    height: 144,
    thickness: 12,
    openRadius: 176,
    animationMs: 700,
    holdOpenMs: 1200,
    minX: 9_082,
    minY: 7_888,
    maxX: 9_094,
    maxY: 8_048
  });
  assert.deepEqual(runtime.serviceBindings, [{
    id: 'westside-auto-repair',
    type: 'repair',
    label: 'Westside Auto Repair',
    x: 9_488,
    y: 8_064
  }]);
  assert.equal(runtime.floorConnectors.length, 1);
  assert.equal(runtime.obstacles.length, 9);
});

test('manifest parser rejects duplicate IDs and invalid geometry', () => {
  const duplicate = structuredClone(BUILDING_MANIFEST) as unknown as {
    buildings: Array<{id: string}>;
  };
  duplicate.buildings[1].id = duplicate.buildings[0].id;
  assert.throws(() => parseBuildingManifest(duplicate, 'duplicate.json'), /duplicate building id/);

  const invalidBounds = structuredClone(BUILDING_MANIFEST) as unknown as {
    buildings: Array<{shell: {bounds: {maxX: number; minX: number}}}>;
  };
  invalidBounds.buildings[0].shell.bounds.maxX = invalidBounds.buildings[0].shell.bounds.minX;
  assert.throws(() => parseBuildingManifest(invalidBounds, 'bounds.json'), /positive dimensions/);

  const invalidKind = structuredClone(BUILDING_MANIFEST) as unknown as {
    buildings: Array<{kind: string}>;
  };
  invalidKind.buildings[0].kind = 'restaurant';
  assert.throws(() => parseBuildingManifest(invalidKind, 'kind.json'), /kind is invalid/);

  const duplicateService = structuredClone(BUILDING_MANIFEST) as unknown as {
    buildings: Array<{serviceBindings: Array<{id: string}>}>;
  };
  duplicateService.buildings.at(-1)!.serviceBindings[0]!.id = 'repair-garage';
  assert.throws(() => parseBuildingManifest(duplicateService, 'service.json'), /duplicate service id/);
});

test('exporter reads building roofs from the shared manifest', () => {
  const exporter = readFileSync(
    'opengta2/src/OpenGta2.WebExporter/WebAssetExporter.cs',
    'utf8'
  );
  const script = readFileSync('scripts/export-gta2-assets.sh', 'utf8');
  assert.doesNotMatch(exporter, /quick-stop-market|ThreeOccluders\s*=/);
  assert.match(exporter, /LoadThreeOccluders/);
  assert.match(exporter, /GeometryOnly/);
  assert.match(script, /shared\/content\/buildings\/buildings\.json/);
  assert.match(script, /GTA2_GEOMETRY_ONLY/);
});
