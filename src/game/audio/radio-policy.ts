import {
  RADIO_OFF,
  RADIO_STATIONS,
  type RadioStation,
  type RadioStationId
} from './radio-stations.ts';

export interface RadioProjection {
  inVehicle: boolean;
  vehicleChanged: boolean;
  vehicleId: string;
  station: RadioStation;
}

export function projectVehicleRadio(
  previousVehicleId: string,
  nextVehicleId: string,
  stationId: RadioStationId
): RadioProjection {
  const vehicleId = nextVehicleId || '';
  return {
    inVehicle: Boolean(vehicleId),
    vehicleChanged: previousVehicleId !== vehicleId,
    vehicleId,
    station: stationForId(stationId)
  };
}

export function cycleStation(current: RadioStationId, direction: -1 | 1): RadioStationId {
  const index = Math.max(0, RADIO_STATIONS.findIndex((station) => station.id === current));
  const next = (index + direction + RADIO_STATIONS.length) % RADIO_STATIONS.length;
  return RADIO_STATIONS[next].id;
}

export function initialStationForVehicle(vehicleId: string): RadioStationId {
  if (!vehicleId) return RADIO_OFF;
  const playable = RADIO_STATIONS.filter((station) => station.tracks.length > 0);
  if (playable.length === 0) return RADIO_OFF;
  return playable[hash(vehicleId) % playable.length].id;
}

function stationForId(id: RadioStationId): RadioStation {
  return RADIO_STATIONS.find((station) => station.id === id) ?? RADIO_STATIONS[0];
}

function hash(value: string): number {
  let result = 0;
  for (let index = 0; index < value.length; index++) {
    result = ((result << 5) - result + value.charCodeAt(index)) | 0;
  }
  return Math.abs(result);
}
