export interface ActorBurnPresentationInput {
  id: string;
  alive: boolean;
  onFire?: boolean;
  fireExpiresAt?: number;
}

export interface ActorBurnPresentation {
  visible: boolean;
  scaleX: number;
  scaleY: number;
  alpha: number;
}

export function actorBurnPresentation(
  actor: ActorBurnPresentationInput,
  nowMs: number
): ActorBurnPresentation {
  const visible = actor.alive && Boolean(actor.onFire);
  const phase = nowMs / 65 + actor.id.length * 1.7;
  return {
    visible,
    scaleX: 0.82 + Math.cos(phase * 0.72) * 0.12,
    scaleY: 0.9 + Math.sin(phase) * 0.2,
    alpha: 0.58 + Math.sin(phase * 1.21) * 0.16
  };
}
