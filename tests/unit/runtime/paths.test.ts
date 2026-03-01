import { describe, expect, it, mock } from 'bun:test';

mock.module('os', () => ({
  homedir: () => '/home/testuser',
}));

describe('getAuditDir', () => {
  it('uses repo runtime by default', async () => {
    const { getAuditDir } = await import('../../../src/core/runtime/paths.js');
    expect(getAuditDir('/repo')).toBe('/repo/.salmonloop/runtime/audit');
  });

  it('uses user runtime when scope is user', async () => {
    const { getAuditDir } = await import('../../../src/core/runtime/paths.js');
    expect(getAuditDir('/repo', 'user')).toBe('/home/testuser/.salmonloop/runtime/audit');
  });
});
