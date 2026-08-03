export type StreetPropFamily = 'dumpster' | 'hydrant' | 'trash-can';

export type StreetPropEffect =
  | {
    kind: 'water-spray';
    texturePath: string;
    anchor: {x: number; y: number};
    frameCount: number;
    frameDurationMs: number;
  }
  | {
    kind: 'trash-burst';
    texturePath: string;
    anchor: {x: number; y: number};
    atlasColumns: number;
    atlasRows: number;
    pieceCount: number;
  };

export interface StreetPropDefinition {
  id: string;
  family: StreetPropFamily;
  variant: string;
  texturePath: string;
  footprint: {width: number; height: number};
  hitRadius: number;
  maxHealth: number;
  effect?: StreetPropEffect;
}

export const STREET_PROPS = Object.freeze({
  'dumpster.dark-green': {
    id: 'dumpster.dark-green',
    family: 'dumpster',
    variant: 'dark-green',
    texturePath: '/assets/custom/props/dumpster/dark-green-damage.png',
    footprint: {width: 46, height: 30},
    hitRadius: 24,
    maxHealth: 42
  },
  'hydrant.red-brass': {
    id: 'hydrant.red-brass',
    family: 'hydrant',
    variant: 'red-brass',
    texturePath: '/assets/custom/props/hydrant/red-brass-damage.png',
    footprint: {width: 18, height: 18},
    hitRadius: 12,
    maxHealth: 30,
    effect: {
      kind: 'water-spray',
      texturePath: '/assets/custom/props/effects/hydrant-water.png',
      anchor: {x: 8, y: 0},
      frameCount: 6,
      frameDurationMs: 95
    }
  },
  'trash-can.galvanized': {
    id: 'trash-can.galvanized',
    family: 'trash-can',
    variant: 'galvanized',
    texturePath: '/assets/custom/props/trash-can/galvanized-damage.png',
    footprint: {width: 24, height: 24},
    hitRadius: 15,
    maxHealth: 24,
    effect: {
      kind: 'trash-burst',
      texturePath: '/assets/custom/props/effects/trash-debris.png',
      anchor: {x: 0, y: 0},
      atlasColumns: 3,
      atlasRows: 3,
      pieceCount: 9
    }
  }
} satisfies Record<string, StreetPropDefinition>);

export type StreetPropDefinitionId = keyof typeof STREET_PROPS;

export const STREET_PROP_PROTOTYPE_IDS = Object.freeze(
  Object.keys(STREET_PROPS) as StreetPropDefinitionId[]
);

export function streetPropDefinition(id: string): StreetPropDefinition | undefined {
  return STREET_PROPS[id as StreetPropDefinitionId];
}

export function streetPropDamageStage(health: number, maxHealth: number): 0 | 1 | 2 {
  if (health <= 0) return 2;
  return health <= maxHealth * 0.66 ? 1 : 0;
}
