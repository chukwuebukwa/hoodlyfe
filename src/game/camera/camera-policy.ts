export type CameraFollowMode = 'player' | 'vehicle';
export type CameraPresentationMode = 'overhead' | 'explorer';

export interface ExplorerCameraPose {
  position: {x: number; y: number; z: number};
  target: {x: number; y: number; z: number};
}

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

export function explorerCameraPose(
  x: number,
  renderY: number,
  groundZ: number,
  serverAngle: number,
  mode: CameraFollowMode,
  pitch?: number
): ExplorerCameraPose {
  const eyeHeight = mode === 'vehicle' ? 42 : 46;
  const lookDistance = mode === 'vehicle' ? 300 : 220;
  const targetDrop = mode === 'vehicle' ? 14 : 18;
  const resolvedPitch = pitch ?? Math.atan2(-targetDrop, lookDistance);
  const horizontalDistance = Math.cos(resolvedPitch) * lookDistance;
  return {
    position: {x, y: renderY, z: groundZ + eyeHeight},
    target: {
      x: x + Math.cos(serverAngle) * horizontalDistance,
      y: renderY - Math.sin(serverAngle) * horizontalDistance,
      z: groundZ + eyeHeight + Math.sin(resolvedPitch) * lookDistance
    }
  };
}
