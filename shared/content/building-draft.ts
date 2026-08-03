import type {BuildingAuthorDraft} from '../../src/game/building-author/building-candidate-policy.ts';
import {
  parseBuildingManifest,
  type BuildingDefinition,
  type BuildingManifest,
  type SourceRect
} from './building-manifest.ts';

export interface PromoteBuildingDraftOptions {
  readonly id?: string;
  readonly label?: string;
  readonly replace?: boolean;
}

const ID_PATTERN = /^[a-z][a-z0-9-]*$/;

export function parseBuilderDraft(raw: unknown): BuildingAuthorDraft {
  if (!raw || typeof raw !== 'object') throw new Error('Builder draft must be an object.');
  const draft = raw as Partial<BuildingAuthorDraft>;
  if (draft.version !== 1 || draft.generatedBy !== 'nock0-builder-gun' || draft.status !== 'needs-export') {
    throw new Error('Input is not a Builder Gun v1 export.');
  }
  if (!draft.building || typeof draft.building.id !== 'string' || !draft.building.shell?.bounds) {
    throw new Error('Builder draft has no complete building definition.');
  }
  return draft as BuildingAuthorDraft;
}

export function promoteBuildingDraft(
  rawDraft: unknown,
  rawManifest: unknown,
  triangleCount: number,
  options: PromoteBuildingDraftOptions = {}
): BuildingManifest {
  const draft = parseBuilderDraft(rawDraft);
  if (!Number.isSafeInteger(triangleCount) || triangleCount <= 0) {
    throw new Error('triangleCount must be a positive integer.');
  }
  const manifest = parseBuildingManifest(rawManifest, 'building manifest');
  const id = options.id ?? draft.building.id;
  if (!ID_PATTERN.test(id)) throw new Error('The production building id must be kebab-case.');
  const label = options.label?.trim() || draft.building.label;
  const building = structuredClone(draft.building) as unknown as BuildingDefinition;
  Object.assign(building, {id, label});
  Object.assign(building.shell, {expectedTriangleCount: triangleCount});
  Object.assign(building, {
    serviceBindings: building.serviceBindings.map((service) => ({
      ...service,
      id: `${id}-${service.type === 'repair' ? 'repair' : 'checkout'}`
    }))
  });

  const buildings = [...manifest.buildings];
  const conflicts = buildings
    .map((existing, index) => ({existing, index}))
    .filter(({existing}) => existing.id === id || footprintsOverlap(existing.footprints, building.footprints));
  if (conflicts.length > 0 && !options.replace) {
    throw new Error(`Draft conflicts with authored building "${conflicts[0].existing.id}". Use --replace intentionally.`);
  }
  if (conflicts.length > 1) throw new Error('Draft overlaps more than one authored building. Resolve the footprint manually.');
  if (conflicts.length === 1) buildings.splice(conflicts[0].index, 1, building);
  else buildings.push(building);

  return parseBuildingManifest({...manifest, buildings}, 'promoted building manifest');
}

function footprintsOverlap(left: readonly SourceRect[], right: readonly SourceRect[]): boolean {
  return left.some((a) => right.some((b) => (
    a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY
  )));
}
