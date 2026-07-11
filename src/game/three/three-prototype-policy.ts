export interface PrototypeAtlas {
  columns: number;
  rows: number;
}

export interface PrototypeVertexUv {
  u: number;
  v: number;
  tile: number;
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
