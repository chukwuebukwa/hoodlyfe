export type RadioStationId = 'station-0' | 'station-1' | 'station-3' | 'radio-off';

export interface RadioTrack {
  src: string;
  title: string;
  artist?: string;
}

export interface RadioStation {
  id: RadioStationId;
  label: string;
  shortLabel: string;
  tracks: RadioTrack[];
  defaultVolume: number;
}

export const RADIO_OFF: RadioStationId = 'radio-off';

export const RADIO_STATIONS: RadioStation[] = [
  {
    id: 'station-0',
    label: 'Street FM',
    shortLabel: 'NCK-FM',
    tracks: [
      {
        src: '/assets/audio/station0.mp3',
        title: 'Station 0'
      }
    ],
    defaultVolume: 0.42
  },
  {
    id: 'station-1',
    label: 'Second Drive Radio',
    shortLabel: 'SDR',
    tracks: [
      {
        src: '/assets/audio/station1.mp3',
        title: 'Station 1'
      }
    ],
    defaultVolume: 0.42
  },
  {
    id: 'station-3',
    label: 'Frost FM',
    shortLabel: 'FROST',
    tracks: [
      {
        src: '/assets/audio/station3.mp3',
        title: 'Station 3'
      }
    ],
    defaultVolume: 0.42
  },
  {
    id: RADIO_OFF,
    label: 'Radio Off',
    shortLabel: 'OFF',
    tracks: [],
    defaultVolume: 0
  }
];

export function stationById(id: RadioStationId): RadioStation {
  return RADIO_STATIONS.find((station) => station.id === id) ?? RADIO_STATIONS[0];
}

export function isRadioStationId(value: string | null): value is RadioStationId {
  return RADIO_STATIONS.some((station) => station.id === value);
}
