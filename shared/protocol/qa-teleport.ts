import {BUILDING_MANIFEST} from '../content/building-manifest.ts';

export const QA_TELEPORT_MESSAGE = 'qa.teleport';

export const QA_TELEPORT_DESTINATIONS = Object.freeze([
  Object.freeze({id: 'spawn', label: 'Main Spawn'}),
  ...BUILDING_MANIFEST.buildings.map(({id, label}) => Object.freeze({id, label}))
]);

export type QaTeleportDestinationId = string;

export interface QaTeleportMessage {
  destinationId: QaTeleportDestinationId;
}

const QA_TELEPORT_DESTINATION_IDS = new Set<string>(
  QA_TELEPORT_DESTINATIONS.map(({id}) => id)
);

export function isQaTeleportMessage(value: unknown): value is QaTeleportMessage {
  if (!value || typeof value !== 'object') return false;
  const destinationId = (value as {destinationId?: unknown}).destinationId;
  return typeof destinationId === 'string' && QA_TELEPORT_DESTINATION_IDS.has(destinationId);
}
