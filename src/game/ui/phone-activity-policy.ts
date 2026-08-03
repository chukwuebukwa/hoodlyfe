import type {GameWorldId} from '../runtime/world-catalog.ts';

export interface PhoneActivityProjection {
  actionLabel: string;
  description: string;
  destination: GameWorldId;
  locationLabel: string;
  meta: string;
  title: string;
  glyph: 'car-front' | 'crosshair' | 'map';
}

export function projectPhoneActivity(currentWorld: GameWorldId): PhoneActivityProjection {
  return projectPhoneActivities(currentWorld)[0];
}

export function projectPhoneActivities(currentWorld: GameWorldId): PhoneActivityProjection[] {
  if (currentWorld === 'raceway' || currentWorld === 'deathmatch') {
    return [{
      actionLabel: 'Exit to Freeroam',
      description: 'Leave the current activity and reconnect to the Industrial District freeroam session.',
      destination: 'industrial-district',
      locationLabel: currentWorld === 'raceway' ? 'Raceway' : 'Foundry Yard',
      meta: 'Exit activity',
      title: 'Freeroam',
      glyph: 'map'
    }];
  }
  return [
    {
      actionLabel: 'Enter raceway',
      description: 'Travel to a traffic-free circuit with an authoritative six-driver race session.',
      destination: 'raceway',
      locationLabel: freeroamLocationLabel(currentWorld),
      meta: '1-6 drivers · 3 laps',
      title: 'Raceway',
      glyph: 'car-front'
    },
    {
      actionLabel: 'Enter deathmatch',
      description: 'Fight in Foundry Yard. First to 15 eliminations wins the match payout.',
      destination: 'deathmatch',
      locationLabel: freeroamLocationLabel(currentWorld),
      meta: '1-8 players · first to 15',
      title: 'Deathmatch',
      glyph: 'crosshair'
    }
  ];
}

function freeroamLocationLabel(currentWorld: GameWorldId): string {
  if (currentWorld === 'downtown') return 'Downtown District';
  if (currentWorld === 'residential') return 'Residential District';
  if (currentWorld === 'world') return 'Greater NOCK0';
  return 'Industrial District';
}
