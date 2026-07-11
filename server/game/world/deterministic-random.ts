export type RandomKey = string | number;

export class DeterministicRandom {
  private readonly seed: string;

  constructor(seed: RandomKey) {
    this.seed = String(seed);
  }

  unit(stream: string, key: RandomKey): number {
    if (!stream) throw new Error('A named random stream is required.');
    return hash32(`${this.seed}\u0000${stream}\u0000${key}`) / 0x1_0000_0000;
  }

  range(stream: string, key: RandomKey, min: number, max: number): number {
    if (!Number.isFinite(min) || !Number.isFinite(max) || max < min) {
      throw new RangeError('Random range bounds must be finite and ordered.');
    }
    return min + (max - min) * this.unit(stream, key);
  }

  integer(stream: string, key: RandomKey, min: number, maxExclusive: number): number {
    if (!Number.isInteger(min) || !Number.isInteger(maxExclusive) || maxExclusive <= min) {
      throw new RangeError('Random integer bounds must be integers with maxExclusive greater than min.');
    }
    return min + Math.floor(this.unit(stream, key) * (maxExclusive - min));
  }
}

export function hash32(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d);
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x846ca68b);
  hash ^= hash >>> 16;
  return hash >>> 0;
}
