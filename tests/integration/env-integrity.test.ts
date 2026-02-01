import { spawn } from 'child_process';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { describe, expect, it, vi } from 'vitest';

/**
 * 🛡️ ENVIRONMENT INTEGRITY GUARD 🛡️
 *
 * This test file serves as a canary to ensure that the integration test environment
 * has NOT been compromised by global mocks.
 *
 * Integration tests MUST run against the real file system and real child processes.
 * If this test fails, it means some configuration (setup.ts, vitest.config.ts)
 * or a leaked mock has hijacked the environment.
 */
describe('Integration Environment Integrity (Guard)', () => {
  it('should NOT have mocked fs module (Sync)', () => {
    // vi.isMockFunction returns true for both vi.mock() and vi.spyOn()
    if (vi.isMockFunction(fs.readFileSync)) {
      throw new Error('CRITICAL: fs.readFileSync is mocked! Integration tests must use real FS.');
    }
    if (vi.isMockFunction(fs.writeFileSync)) {
      throw new Error('CRITICAL: fs.writeFileSync is mocked! Integration tests must use real FS.');
    }
  });

  it('should NOT have mocked fs/promises module', () => {
    if (vi.isMockFunction(fsp.readFile)) {
      throw new Error(
        'CRITICAL: fs.promises.readFile is mocked! Integration tests must use real FS.',
      );
    }
    if (vi.isMockFunction(fsp.writeFile)) {
      throw new Error(
        'CRITICAL: fs.promises.writeFile is mocked! Integration tests must use real FS.',
      );
    }
  });

  it('should NOT have mocked child_process', () => {
    if (vi.isMockFunction(spawn)) {
      throw new Error(
        'CRITICAL: child_process.spawn is mocked! Integration tests must use real processes.',
      );
    }
  });

  it('should be able to perform REAL disk I/O', async () => {
    const guardFile = join(tmpdir(), `salmon-guard-${Date.now()}.txt`);
    const content = 'The real world is not mocked.';

    try {
      // 1. Write
      await fsp.writeFile(guardFile, content, 'utf-8');

      // 2. Stat (verify existence)
      const stats = await fsp.stat(guardFile);
      expect(stats.isFile()).toBe(true);
      expect(stats.size).toBeGreaterThan(0);

      // 3. Read
      const readBack = await fsp.readFile(guardFile, 'utf-8');
      expect(readBack).toBe(content);
    } catch (error) {
      throw new Error(
        `Failed to perform real disk I/O: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      // Cleanup
      await fsp.rm(guardFile, { force: true }).catch(() => {});
    }
  });
});
