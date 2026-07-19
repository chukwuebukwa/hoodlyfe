import assert from 'node:assert/strict';
import test from 'node:test';
import type {ThreeMapChunkDescriptor} from '../src/game/three/three-map-format.ts';
import {selectThreeMapChunkInterest} from '../src/game/three/three-map-streaming-policy.ts';

const BLOCK_SIZE = 64;
const CHUNK_SIZE = 8;
const CHUNK_WORLD_SIZE = BLOCK_SIZE * CHUNK_SIZE;

test('three map streaming prioritizes visible, preload, and retained chunk rings', () => {
  const interests = selectThreeMapChunkInterest({
    chunks: chunkGrid(5, 5),
    blockSize: BLOCK_SIZE,
    chunkSize: CHUNK_SIZE,
    focusX: CHUNK_WORLD_SIZE * 1.5,
    focusY: CHUNK_WORLD_SIZE * 1.5,
    halfWidth: 100,
    halfHeight: 100
  });
  const tiers = new Map(interests.map(({descriptor, tier}) => [descriptor.id, tier]));

  assert.equal(tiers.get('1:1'), 'visible');
  assert.equal(tiers.get('0:1'), 'preload');
  assert.equal(tiers.get('2:2'), 'preload');
  assert.equal(tiers.get('3:1'), 'retained');
  assert.equal(tiers.has('4:4'), false);
  assert.deepEqual(
    interests.map(({tier}) => tier),
    [...interests.map(({tier}) => tier)].sort((left, right) => tierRank(left) - tierRank(right)),
    'Load priority must never place retained chunks ahead of visible or preload chunks.'
  );
});

test('three map streaming adds motion-lookahead chunks without retaining the entire world', () => {
  const chunks = chunkGrid(8, 3);
  const stationary = selectThreeMapChunkInterest({
    chunks,
    blockSize: BLOCK_SIZE,
    chunkSize: CHUNK_SIZE,
    focusX: CHUNK_WORLD_SIZE * 1.5,
    focusY: CHUNK_WORLD_SIZE * 1.5,
    halfWidth: 100,
    halfHeight: 100
  });
  const moving = selectThreeMapChunkInterest({
    chunks,
    blockSize: BLOCK_SIZE,
    chunkSize: CHUNK_SIZE,
    focusX: CHUNK_WORLD_SIZE * 1.5,
    focusY: CHUNK_WORLD_SIZE * 1.5,
    halfWidth: 100,
    halfHeight: 100,
    lookaheadX: CHUNK_WORLD_SIZE * 3.5,
    lookaheadY: CHUNK_WORLD_SIZE * 1.5
  });
  const stationaryIds = new Set(stationary.map(({descriptor}) => descriptor.id));
  const movingIds = new Set(moving.map(({descriptor}) => descriptor.id));

  assert.equal(stationaryIds.has('4:1'), false);
  assert.equal(movingIds.has('4:1'), true, 'Chunks ahead of motion should enter the preload set.');
  assert.ok(moving.length < chunks.length, 'Lookahead must not promote the complete map.');
});

function chunkGrid(columns: number, rows: number): ThreeMapChunkDescriptor[] {
  return Array.from({length: columns * rows}, (_, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    return {
      id: `${column}:${row}`,
      column,
      row,
      x: column * CHUNK_SIZE,
      y: row * CHUNK_SIZE,
      size: CHUNK_SIZE,
      file: `chunks/${column}-${row}.json`,
      triangleCount: 1
    };
  });
}

function tierRank(tier: 'visible' | 'preload' | 'retained'): number {
  if (tier === 'visible') return 0;
  if (tier === 'preload') return 1;
  return 2;
}
