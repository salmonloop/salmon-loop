import { describe, expect, it } from 'bun:test';

import { CachedService } from '../../../../../src/core/grizzco/services/CachedService.js';
import type { IDataService } from '../../../../../src/core/grizzco/services/types.js';

describe('CachedService', () => {
  it('deduplicates concurrent fetch calls for the same key', async () => {
    let calls = 0;
    const service: IDataService = {
      id: 'test',
      fetch: async () => {
        calls += 1;
        await Promise.resolve();
        return 'value';
      },
    };
    const cached = new CachedService(service);
    const ctx = { workspace: { workPath: '/repo' } } as any;

    const results = await Promise.all(Array.from({ length: 50 }, () => cached.fetch(ctx)));

    expect(calls).toBe(1);
    expect(results.every((item) => item === 'value')).toBe(true);
  });

  it('does not cache failed fetches and allows retry', async () => {
    let calls = 0;
    const service: IDataService = {
      id: 'test',
      fetch: async () => {
        calls += 1;
        if (calls === 1) throw new Error('boom');
        return 'ok';
      },
    };
    const cached = new CachedService(service);
    const ctx = { workspace: { workPath: '/repo' } } as any;

    await expect(cached.fetch(ctx)).rejects.toThrow('boom');
    await expect(cached.fetch(ctx)).resolves.toBe('ok');
    expect(calls).toBe(2);
  });
});
