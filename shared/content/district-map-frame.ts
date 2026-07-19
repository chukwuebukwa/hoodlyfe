import {DISTRICT_MAP_GENERATED_FRAME} from './district-map-frame.generated.ts';

export interface DistrictMapFrame {
  origin: {x: number; y: number};
  size: {width: number; height: number};
  tileSize: number;
}

export interface DistrictPoint {
  x: number;
  y: number;
}

export interface DistrictBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export const DISTRICT_REFERENCE_FRAME: Readonly<DistrictMapFrame> = Object.freeze({
  origin: Object.freeze({x: 96, y: 97}),
  size: Object.freeze({width: 64, height: 64}),
  tileSize: 64
});

export const DISTRICT_ACTIVE_FRAME: Readonly<DistrictMapFrame> = DISTRICT_MAP_GENERATED_FRAME;

export const DISTRICT_WORLD_SIZE = Object.freeze({
  width: DISTRICT_ACTIVE_FRAME.size.width * DISTRICT_ACTIVE_FRAME.tileSize,
  height: DISTRICT_ACTIVE_FRAME.size.height * DISTRICT_ACTIVE_FRAME.tileSize
});

export function districtAuthoringOffset(
  frame: DistrictMapFrame = DISTRICT_ACTIVE_FRAME
): Readonly<DistrictPoint> {
  return Object.freeze({
    x: (DISTRICT_REFERENCE_FRAME.origin.x - frame.origin.x) * frame.tileSize,
    y: (DISTRICT_REFERENCE_FRAME.origin.y - frame.origin.y) * frame.tileSize
  });
}

export function districtPoint(
  x: number,
  y: number,
  frame: DistrictMapFrame = DISTRICT_ACTIVE_FRAME
): DistrictPoint {
  const offset = districtAuthoringOffset(frame);
  return {x: x + offset.x, y: y + offset.y};
}

export function districtBounds(
  bounds: DistrictBounds,
  frame: DistrictMapFrame = DISTRICT_ACTIVE_FRAME
): DistrictBounds {
  const offset = districtAuthoringOffset(frame);
  return {
    minX: bounds.minX + offset.x,
    minY: bounds.minY + offset.y,
    maxX: bounds.maxX + offset.x,
    maxY: bounds.maxY + offset.y
  };
}
