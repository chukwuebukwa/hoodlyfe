import type {ThreeMapChunkDescriptor} from './three-map-format.ts';

export const THREE_MAP_STREAMING = Object.freeze({
  preloadRings: 1,
  retentionRings: 2,
  maximumConcurrentLoads: 4,
  lookaheadSeconds: 0.8,
  maximumLookaheadChunks: 2
});

export type ThreeMapChunkTier = 'visible' | 'preload' | 'retained';

export interface ThreeMapChunkInterest {
  descriptor: ThreeMapChunkDescriptor;
  tier: ThreeMapChunkTier;
  priority: number;
}

export interface ThreeMapInterestInput {
  chunks: readonly ThreeMapChunkDescriptor[];
  blockSize: number;
  chunkSize: number;
  focusX: number;
  focusY: number;
  halfWidth: number;
  halfHeight: number;
  lookaheadX?: number;
  lookaheadY?: number;
}

export function selectThreeMapChunkInterest(input: ThreeMapInterestInput): ThreeMapChunkInterest[] {
  const chunkWorldSize = input.blockSize * input.chunkSize;
  const preloadMargin = THREE_MAP_STREAMING.preloadRings * chunkWorldSize;
  const retentionMargin = THREE_MAP_STREAMING.retentionRings * chunkWorldSize;
  const focus = {x: input.focusX, y: input.focusY};
  const lookahead = {
    x: input.lookaheadX ?? input.focusX,
    y: input.lookaheadY ?? input.focusY
  };
  const visible = boundsAround(focus, input.halfWidth, input.halfHeight, 0);
  const preload = unionBounds(
    boundsAround(focus, input.halfWidth, input.halfHeight, preloadMargin),
    boundsAround(lookahead, input.halfWidth, input.halfHeight, preloadMargin)
  );
  const retained = unionBounds(
    boundsAround(focus, input.halfWidth, input.halfHeight, retentionMargin),
    boundsAround(lookahead, input.halfWidth, input.halfHeight, retentionMargin)
  );
  const interests: ThreeMapChunkInterest[] = [];
  for (const descriptor of input.chunks) {
    const bounds = chunkBounds(descriptor, input.blockSize);
    const tier = intersects(bounds, visible)
      ? 'visible'
      : intersects(bounds, preload)
        ? 'preload'
        : intersects(bounds, retained) ? 'retained' : undefined;
    if (!tier) continue;
    const centerX = (bounds.minX + bounds.maxX) / 2;
    const centerY = (bounds.minY + bounds.maxY) / 2;
    const distance = Math.hypot(centerX - lookahead.x, centerY - lookahead.y);
    interests.push({
      descriptor,
      tier,
      priority: tierPriority(tier) + distance
    });
  }
  return interests.sort((left, right) => (
    left.priority - right.priority || left.descriptor.id.localeCompare(right.descriptor.id)
  ));
}

function tierPriority(tier: ThreeMapChunkTier): number {
  if (tier === 'visible') return 0;
  if (tier === 'preload') return 1_000_000;
  return 2_000_000;
}

interface Bounds {minX: number; minY: number; maxX: number; maxY: number;}

function boundsAround(
  center: {x: number; y: number},
  halfWidth: number,
  halfHeight: number,
  margin: number
): Bounds {
  return {
    minX: center.x - Math.max(0, halfWidth) - margin,
    minY: center.y - Math.max(0, halfHeight) - margin,
    maxX: center.x + Math.max(0, halfWidth) + margin,
    maxY: center.y + Math.max(0, halfHeight) + margin
  };
}

function unionBounds(left: Bounds, right: Bounds): Bounds {
  return {
    minX: Math.min(left.minX, right.minX),
    minY: Math.min(left.minY, right.minY),
    maxX: Math.max(left.maxX, right.maxX),
    maxY: Math.max(left.maxY, right.maxY)
  };
}

function chunkBounds(descriptor: ThreeMapChunkDescriptor, blockSize: number): Bounds {
  return {
    minX: descriptor.x * blockSize,
    minY: descriptor.y * blockSize,
    maxX: (descriptor.x + descriptor.size) * blockSize,
    maxY: (descriptor.y + descriptor.size) * blockSize
  };
}

function intersects(left: Bounds, right: Bounds): boolean {
  return left.maxX >= right.minX && left.minX <= right.maxX &&
    left.maxY >= right.minY && left.minY <= right.maxY;
}
