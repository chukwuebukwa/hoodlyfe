export interface PrototypeAtlas {
  columns: number;
  rows: number;
}

export interface PrototypeVertexUv {
  u: number;
  v: number;
  tile: number;
}

export interface PrototypeSurfaceGrid {
  blockSize: number;
  origin: {x: number; y: number};
  surfaces: {
    width: number;
    height: number;
    values: readonly number[];
  };
}

export function atlasUv(vertex: PrototypeVertexUv, atlas: PrototypeAtlas): [number, number] {
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
  map: PrototypeSurfaceGrid
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
  defaultSurfaceId: string
): number {
  return surfaceId && surfaceId !== defaultSurfaceId && authoredHeight !== undefined
    ? authoredHeight
    : mapHeight;
}

export function faceBrightness(shading: number): number {
  return clamp(1 - shading * 15 / 31, 0.18, 1);
}

export function serverYToThree(y: number): number {
  return -y;
}

export function serverAngleToThree(angle: number): number {
  return -angle;
}

export function serverPedestrianAngleToThree(angle: number): number {
  return serverAngleToThree(angle) + Math.PI / 2;
}

export function serverVehicleAngleToThree(angle: number): number {
  return serverAngleToThree(angle) - Math.PI / 2;
}

export function vehicleLampAnchor(
  x: number,
  y: number,
  angle: number,
  forwardOffset: number
): {x: number; y: number; rotation: number} {
  return {
    x: x + Math.cos(angle) * forwardOffset,
    y: serverYToThree(y + Math.sin(angle) * forwardOffset),
    rotation: serverAngleToThree(angle)
  };
}

export function renderedVehicleLampAnchor(
  x: number,
  threeY: number,
  spriteRotation: number,
  forwardOffset: number
): {x: number; y: number; rotation: number} {
  const physicalRotation = spriteRotation + Math.PI / 2;
  return {
    x: x + Math.cos(physicalRotation) * forwardOffset,
    y: threeY + Math.sin(physicalRotation) * forwardOffset,
    rotation: physicalRotation
  };
}

export function threePointToServerAimAngle(
  originX: number,
  originY: number,
  targetX: number,
  targetThreeY: number
): number {
  return Math.atan2(-targetThreeY - originY, targetX - originX);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
