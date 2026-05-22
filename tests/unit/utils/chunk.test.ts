import { describe, it, expect } from 'bun:test';

import { chunk } from '../../../src/utils/chunk.js';

describe('chunk', () => {
  it('should split an array into chunks of the given size', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it('should return an empty array if the input array is empty', () => {
    expect(chunk([], 2)).toEqual([]);
  });

  it('should return a single chunk if the array size is smaller than the chunk size', () => {
    expect(chunk([1, 2, 3], 5)).toEqual([[1, 2, 3]]);
  });
});
