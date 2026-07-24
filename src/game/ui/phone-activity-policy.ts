import type {GameWorldId} from '../runtime/world-catalog.ts';

export interface PhoneActivityProjection {
  actionLabel: string;
  description: string;
  destination: GameWorldId;
  locationLabel: string;
  meta: string;
  title: string;
}

export function projectPhoneActivity(currentWorld: GameWorldId): PhoneActivityProjection {
  if (currentWorld === 'raceway') {
    return {
      actionLabel: 'Return to city',
      description: 'Leave the closed circuit and reconnect to the Industrial District.',
      destination: 'industrial-district',
      locationLabel: 'Nock0 Raceway',
      meta: 'District travel',
      title: 'Industrial District'
    };
  }
  return {
    actionLabel: 'Enter raceway',
    description: 'Travel to a traffic-free circuit with an authoritative six-driver race session.',
    destination: 'raceway',
    locationLabel: 'Industrial District',
    meta: '1-6 drivers · 3 laps',
    title: 'Nock0 Raceway'
  };
}
