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
      actionLabel: 'Exit to Freeroam',
      description: 'Leave the current race and reconnect to the Industrial District freeroam session.',
      destination: 'industrial-district',
      locationLabel: 'Raceway',
      meta: 'Exit activity',
      title: 'Freeroam'
    };
  }
  return {
    actionLabel: 'Enter raceway',
    description: 'Travel to a traffic-free circuit with an authoritative six-driver race session.',
    destination: 'raceway',
    locationLabel: 'Industrial District',
    meta: '1-6 drivers · 3 laps',
    title: 'Raceway'
  };
}
