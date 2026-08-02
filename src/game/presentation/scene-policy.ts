export interface AtlasUvLayout {
  columns: number;
  rows: number;
}

export interface AtlasUvVertex {
  u: number;
  v: number;
  tile: number;
}

export interface SurfaceHeightGrid {
  blockSize: number;
  origin: {x: number; y: number};
  surfaces: {
    width: number;
    height: number;
    values: readonly number[];
  };
}

export function atlasUv(vertex: AtlasUvVertex, atlas: AtlasUvLayout): [number, number] {
  const column = vertex.tile % atlas.columns;
  const row = Math.floor(vertex.tile / atlas.columns);
  return [
    (column + vertex.u) / atlas.columns,
    (row + vertex.v) / atlas.rows
  ];
}

export function perspectiveHeightForSpan(span: number, fieldOfViewDegrees = 45): number {
  const safeSpan = Math.max(1, span);
  const radians = fieldOfViewDegrees * Math.PI / 180;
  return safeSpan * 0.5 / Math.tan(radians * 0.5);
}

export function mapSurfaceHeightAt(
  x: number,
  y: number,
  map: SurfaceHeightGrid
): number {
  const column = clamp(
    Math.floor((x - map.origin.x) / map.blockSize),
    0,
    map.surfaces.width - 1
  );
  const row = clamp(
    Math.floor((y - map.origin.y) / map.blockSize),
    0,
    map.surfaces.height - 1
  );
  return (map.surfaces.values[row * map.surfaces.width + column] ?? 0) * map.blockSize;
}

export function renderedSurfaceHeight(
  surfaceId: string | undefined,
  authoredHeight: number | undefined,
  mapHeight: number,
  _defaultSurfaceId: string
): number {
  return surfaceId && authoredHeight !== undefined ? authoredHeight : mapHeight;
}

export function faceBrightness(shading: number): number {
  return clamp(1 - shading * 15 / 31, 0.18, 1);
}

export function serverYToScene(y: number): number {
  return -y;
}

export function serverAngleToScene(angle: number): number {
  return -angle;
}

export function weaponSpriteVerticalScale(angle: number): 1 | -1 {
  return Math.cos(angle) < 0 ? -1 : 1;
}

export function weaponDepthOffset(angle: number, occupied: boolean): number {
  return !occupied && Math.sin(angle) < 0 ? -1 : 2;
}

export function serverPedestrianAngleToScene(angle: number): number {
  return serverAngleToScene(angle) + Math.PI / 2;
}

export function serverVehicleAngleToScene(angle: number): number {
  return serverAngleToScene(angle) - Math.PI / 2;
}

export function vehicleLampAnchor(
  x: number,
  y: number,
  angle: number,
  forwardOffset: number
): {x: number; y: number; rotation: number} {
  return {
    x: x + Math.cos(angle) * forwardOffset,
    y: serverYToScene(y + Math.sin(angle) * forwardOffset),
    rotation: serverAngleToScene(angle)
  };
}

export function renderedVehicleLampAnchor(
  x: number,
  sceneY: number,
  spriteRotation: number,
  forwardOffset: number
): {x: number; y: number; rotation: number} {
  const physicalRotation = spriteRotation + Math.PI / 2;
  return {
    x: x + Math.cos(physicalRotation) * forwardOffset,
    y: sceneY + Math.sin(physicalRotation) * forwardOffset,
    rotation: physicalRotation
  };
}

export function scenePointToServerAimAngle(
  originX: number,
  originY: number,
  targetX: number,
  targetSceneY: number
): number {
  return Math.atan2(-targetSceneY - originY, targetX - originX);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
