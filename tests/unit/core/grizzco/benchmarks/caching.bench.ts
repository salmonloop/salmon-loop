import { describe, it, expect, vi } from 'vitest';

import { CachedService } from '../../../../../src/core/grizzco/services/CachedService.js';
import { IDataService } from '../../../../../src/core/grizzco/services/types.js';

describe('Performance: Service Caching', () => {
  it('should prevent redundant fetch calls', async () => {
    const fetchSpy = vi.fn().mockResolvedValue('data');
    const mockService: IDataService = { id: 'test', fetch: fetchSpy };
    const cachedService = new CachedService(mockService);

    const ctx = { workspace: { workPath: '/repo' } } as any;

    const start = performance.now();
    // Simulate 100 concurrent calls (like parallel Apply)
    await Promise.all(
      Array(100)
        .fill(0)
        .map(() => cachedService.fetch(ctx)),
    );
    const duration = performance.now() - start;

    expect(fetchSpy).toHaveBeenCalledTimes(1); // Crucial assertion
    console.log(`100 calls took ${duration.toFixed(2)}ms with caching`);
  });
});
