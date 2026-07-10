export type CameraFollowMode = 'player' | 'vehicle';

export interface CameraFollowPolicy {
  lerpX: number;
  lerpY: number;
  centerOnAcquire: boolean;
}

export function cameraZoom(viewportWidth: number): number {
  return viewportWidth < 700 ? 1.05 : 1.15;
}

export function cameraFollowPolicy(mode: CameraFollowMode): CameraFollowPolicy {
  if (mode === 'vehicle') return {lerpX: 0.12, lerpY: 0.12, centerOnAcquire: false};
  return {lerpX: 0.14, lerpY: 0.14, centerOnAcquire: true};
}

export function cameraTargetKey(mode: CameraFollowMode, entityId: string): string {
  return `${mode}:${entityId}`;
}
