import {
  ON_FOOT_PLAYER_RADIUS,
  ON_FOOT_SIMULATION_STEP_SECONDS,
  integrateOnFootPose,
  type OnFootPose
} from '../../../shared/simulation/on-foot-step.ts';
import type {SurfaceMap} from '../../../shared/world/surface-map.ts';
import type {
  OnFootPredictionMovement,
  OnFootPredictionWorld
} from './on-foot-prediction-controller.ts';

export class SurfaceOnFootPredictionWorld implements OnFootPredictionWorld {
  constructor(private readonly surfaces: SurfaceMap) {}

  step(
    pose: OnFootPose,
    movement: OnFootPredictionMovement,
    movementScale: number
  ): OnFootPose {
    if (pose.spaceId !== 'street' || !pose.surfaceId) return pose;
    const moved = integrateOnFootPose(
      pose,
      {moveX: movement.x, moveY: movement.y},
      ON_FOOT_SIMULATION_STEP_SECONDS,
      {movementScale}
    );
    const surfaceId = this.surfaces.transitionFor(
      pose.surfaceId,
      pose.x,
      pose.y,
      moved.x,
      moved.y,
      'player'
    )?.surfaceId ?? pose.surfaceId;
    if (!this.surfaces.canOccupyConnected(
      surfaceId,
      moved.x,
      moved.y,
      ON_FOOT_PLAYER_RADIUS,
      'player'
    )) return pose;
    return {...moved, surfaceId};
  }
}
