import type {RemoteIntentState} from '../../../shared/protocol/interaction-contracts.ts';

export const REMOTE_INTENT_HOLD_TICKS = 2;
export const REMOTE_INTENT_DECAY_TICKS = 4;

export interface InteractionReplayControl {
  readonly moveX: number;
  readonly moveY: number;
  readonly steering: number;
  readonly throttle: number;
  readonly source: 'local' | 'remote' | 'neutral';
}

export const NEUTRAL_INTERACTION_REPLAY_CONTROL: InteractionReplayControl = Object.freeze({
  moveX: 0,
  moveY: 0,
  steering: 0,
  throttle: 0,
  source: 'neutral'
});

export function continueRemoteIntent(
  intent: RemoteIntentState | undefined,
  replayTick: number
): InteractionReplayControl {
  if (!intent || !Number.isSafeInteger(replayTick)) return NEUTRAL_INTERACTION_REPLAY_CONTROL;
  const age = Math.max(0, replayTick - intent.appliedAtServerTick);
  const scale = age <= REMOTE_INTENT_HOLD_TICKS
    ? 1
    : Math.max(0, 1 - (age - REMOTE_INTENT_HOLD_TICKS) / REMOTE_INTENT_DECAY_TICKS);
  if (scale <= 0) return NEUTRAL_INTERACTION_REPLAY_CONTROL;
  return Object.freeze({
    moveX: finiteClamp(intent.moveX, -1, 1) * scale,
    moveY: finiteClamp(intent.moveY, -1, 1) * scale,
    steering: finiteClamp(intent.steering, -1, 1) * scale,
    throttle: finiteClamp(intent.throttle, -1, 1) * scale,
    source: 'remote'
  });
}

function finiteClamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, Number.isFinite(value) ? value : 0));
}
