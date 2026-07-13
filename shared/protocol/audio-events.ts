export const AUDIO_EVENTS_MESSAGE = 'audio.events';

export type AudioEventKind =
  | 'weapon.fire'
  | 'melee.swing'
  | 'melee.hit'
  | 'explosion'
  | 'fire.ignite'
  | 'vehicle.impact'
  | 'vehicle.fire'
  | 'vehicle.destroyed'
  | 'vehicle.repaired'
  | 'pickup.weapon'
  | 'pickup.cash'
  | 'player.respawn';

export interface AudioEventPayload {
  id: string;
  tick: number;
  kind: AudioEventKind;
  x: number;
  y: number;
  variant?: string;
  intensity?: number;
  sourceId?: string;
}

export interface AudioEventsMessage {
  tick: number;
  events: AudioEventPayload[];
}
