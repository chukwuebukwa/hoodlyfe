import type {InteractionIntentState} from '../../../shared/protocol/interaction-islands.ts';
import type {VehicleControlCommand} from '../../../shared/simulation/vehicle-step.ts';

export const REMOTE_INTENT_HOLD_TICKS = 2;
export const REMOTE_INTENT_DECAY_TICKS = 4;

export function continuedVehicleIntent(
  intent: InteractionIntentState | undefined,
  replayTick: number
): VehicleControlCommand {
  if (!intent || replayTick < intent.appliedAtServerTick) return neutralVehicleIntent();
  const ageTicks = replayTick - intent.appliedAtServerTick;
  const scale = intentScale(ageTicks) * finiteClamp(intent.movementScale, 0, 1);
  return Object.freeze({
    steering: finiteClamp(intent.steering, -1, 1) * scale,
    throttle: finiteClamp(intent.throttle, -1, 1) * scale,
    ...(intent.handbrake && scale > 0 ? {handbrake: true} : {})
  });
}

function intentScale(ageTicks: number): number {
  if (ageTicks <= REMOTE_INTENT_HOLD_TICKS) return 1;
  const decayAge = ageTicks - REMOTE_INTENT_HOLD_TICKS;
  return Math.max(0, 1 - decayAge / REMOTE_INTENT_DECAY_TICKS);
}

function neutralVehicleIntent(): VehicleControlCommand {
  return Object.freeze({steering: 0, throttle: 0});
}

function finiteClamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, Number.isFinite(value) ? value : 0));
}
