import type {PhysicsWorld} from '../../engine/adapters/surface-physics.ts';
import type {OnFootPose} from './on-foot-step.ts';

export function physicsBodyKey(
  kind: 'vehicle' | 'player' | 'pedestrian' | 'prop',
  id: string
): string {
  return `${kind}:${id}`;
}

export function driveHumanoidBody(
  world: PhysicsWorld,
  key: string,
  radius: number,
  pose: OnFootPose,
  desired: OnFootPose,
  deltaSeconds: number
): void {
  const delta = Math.max(0.001, deltaSeconds);
  const state = {
    x: pose.x,
    y: pose.y,
    rotation: 0,
    linvelX: (desired.x - pose.x) / delta,
    linvelY: (desired.y - pose.y) / delta,
    angvel: 0
  };
  if (world.has(key)) world.writeback(key, state);
  else world.registerHumanoid(key, radius, state);
}

export function captureHumanoidBody(
  world: PhysicsWorld,
  key: string,
  spaceId: string
): OnFootPose | undefined {
  const state = world.capture(key);
  return state ? {x: state.x, y: state.y, spaceId} : undefined;
}
