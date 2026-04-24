import { describe, it, expect } from 'bun:test';

import { processInBatches } from '../../../src/core/utils/batch.js';

describe('processInBatches', () => {
  it('should process items in batches', async () => {
    const items = [1, 2, 3, 4, 5];
    let concurrentCount = 0;
    let maxConcurrent = 0;

    const processor = async (item: number) => {
      concurrentCount++;
      maxConcurrent = Math.max(maxConcurrent, concurrentCount);
      await new Promise((resolve) => setTimeout(resolve, 10));
      concurrentCount--;
      return item * 2;
    };

    const results = await processInBatches(items, 2, processor);

    expect(results).toEqual([2, 4, 6, 8, 10]);
    expect(maxConcurrent).toBe(2);
  });

  it('should handle empty arrays', async () => {
    const results = await processInBatches([], 2, async (x) => x);
    expect(results).toEqual([]);
  });
});
