import { describe, it, expect } from 'bun:test';

import { processInBatches } from '../../../src/core/utils/batch.js';

describe('processInBatches', () => {
  it('should process items in batches', async () => {
    const items = [1, 2, 3, 4, 5];
    const results = await processInBatches(items, 2, async (item) => item * 2);
    expect(results).toEqual([2, 4, 6, 8, 10]);
  });
});
