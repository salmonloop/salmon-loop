import { describe, expect, it, mock } from 'bun:test';

mock.module('os', () => ({
  homedir: () => '/home/testuser',
}));

describe('getAuditDir', () => {
  it('uses repo runtime by default', async () => {
    const { getAuditDir } = await import('../../../src/core/runtime/paths.js');
    const result = getAuditDir('/repo');
    expect(result.replace(/\\/g, '/')).toBe('/repo/.salmonloop/runtime/audit');
  });

  it('uses user runtime when scope is user', async () => {
    const { getAuditDir } = await import('../../../src/core/runtime/paths.js');
    const result = getAuditDir('/repo', 'user');
    expect(result.replace(/\\/g, '/')).toBe('/home/testuser/.salmonloop/runtime/audit');
  });
});
