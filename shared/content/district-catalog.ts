export interface DistrictDefinition {
  id: string;
  label: string;
  assetRoot: string;
  activeRuntime: boolean;
}

export const ACTIVE_DISTRICT_ID = 'bil';

export const DISTRICT_CATALOG: readonly DistrictDefinition[] = [
  {
    id: 'bil',
    label: 'Industrial District (BIL)',
    assetRoot: '/assets',
    activeRuntime: true
  },
  {
    id: 'wil',
    label: 'WIL District',
    assetRoot: '/assets/districts/wil',
    activeRuntime: false
  },
  {
    id: 'ste',
    label: 'STE District',
    assetRoot: '/assets/districts/ste',
    activeRuntime: false
  }
] as const;

export function districtDefinition(id: string | null | undefined): DistrictDefinition {
  return DISTRICT_CATALOG.find((district) => district.id === id) ?? DISTRICT_CATALOG[0];
}

export function districtMapAsset(district: DistrictDefinition, file: string): string {
  return `${district.assetRoot}/maps/${file}`;
}

export function districtThreeAsset(district: DistrictDefinition, file: string): string {
  return `${district.assetRoot}/maps/three/${file}`;
}
