import {
  RemoteMotionTimeline,
  type RemoteMotionTimelineOptions
} from './remote-motion-timeline.ts';

export type RemoteActorFamily = 'player' | 'npc' | 'vehicle' | 'prop';

export const REMOTE_TIMELINE_OPTIONS: Readonly<
  Record<RemoteActorFamily, Readonly<RemoteMotionTimelineOptions>>
> = Object.freeze({
  player: Object.freeze({
    teleportDistance: 180,
    maximumExtrapolationSpeed: 320
  }),
  npc: Object.freeze({
    teleportDistance: 180,
    maximumExtrapolationSpeed: 360
  }),
  vehicle: Object.freeze({
    teleportDistance: 320,
    maximumExtrapolationSpeed: 1_100
  }),
  prop: Object.freeze({
    teleportDistance: 220,
    maximumExtrapolationSpeed: 900,
    maximumAngularSpeed: Math.PI * 12
  })
});

export function createRemoteMotionTimeline(family: RemoteActorFamily): RemoteMotionTimeline {
  return new RemoteMotionTimeline(REMOTE_TIMELINE_OPTIONS[family]);
}
