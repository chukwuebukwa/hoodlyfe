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

export function cameraRecoilOffset(
  kickDistance: number,
  serverAngle: number,
  mode: CameraPresentationMode,
  passenger = false,
  reducedMotion = false
): {x: number; y: number; pitch: number} {
  if (
    reducedMotion ||
    !Number.isFinite(kickDistance) ||
    kickDistance <= 0 ||
    !Number.isFinite(serverAngle)
  ) {
    return {x: 0, y: 0, pitch: 0};
  }
  const amount = kickDistance * (passenger ? 0.5 : 1);
  return mode === 'explorer'
    ? {x: 0, y: 0, pitch: amount * 0.006}
    : {
        x: -Math.cos(serverAngle) * amount,
        y: Math.sin(serverAngle) * amount,
        pitch: 0
      };
}

export function cameraZoom(viewportWidth: number): number {
  return viewportWidth < 700 ? 1.05 : 1.15;
}

export function drivingCameraZoom(speed: number): number {
  const speedRatio = Math.max(0, Math.min(1, (Math.abs(speed) - 80) / 370));
  const easedSpeed = speedRatio * speedRatio * (3 - 2 * speedRatio);
  return 1.65 - easedSpeed * 0.55;
}

export function smoothDrivingCameraZoom(
  currentZoom: number,
  targetZoom: number,
  deltaSeconds: number
): number {
  const response = targetZoom < currentZoom ? 4.2 : 2.6;
  const blend = 1 - Math.exp(-Math.max(0, deltaSeconds) * response);
  return currentZoom + (targetZoom - currentZoom) * blend;
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
