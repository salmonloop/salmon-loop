/**
 * Integration tests for skill discovery path trust boundary.
 *
 * Uses real filesystem to verify:
 * - Malicious repo config with ../../../etc path traversal is rejected
 * - Symlink escape attempt is detected and rejected
 *
 * Validates: Requirements 3.1, 3.2, 3.3, 3.4, 10.1, 10.2
 */
import * as fsp from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';

// Mock only the logger (not fs) — integration tests use real filesystem
const auditMock = mock();

mock.module('../../../../src/core/observability/logger.js', () => ({
  getLogger: () => ({
    audit: auditMock,
    debug: mock(),
    info: mock(),
    warn: mock(),
    error: mock(),
  }),
  tryGetLogger: () => ({
    audit: auditMock,
    debug: mock(),
    info: mock(),
    warn: mock(),
    error: mock(),
  }),
}));

import { isWithinRoot } from '../../../../src/core/extensions/paths.js';

describe('Skill path trust boundary (integration)', () => {
  let repoRoot: string;

  beforeEach(async () => {
    repoRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'skill-trust-'));
    // Create a valid skills directory inside the repo
    await fsp.mkdir(path.join(repoRoot, '.salmonloop', 'skills'), { recursive: true });
    auditMock.mockReset();
  });

  afterEach(async () => {
    await fsp.rm(repoRoot, { recursive: true, force: true });
  });

  describe('malicious repo config with path traversal', () => {
    it('rejects ../../../etc path that escapes repo root', () => {
      const maliciousPath = path.resolve(repoRoot, '../../../etc');
      expect(isWithinRoot(maliciousPath, repoRoot)).toBe(false);
    });

    it('rejects deeply nested traversal that escapes root', () => {
      const maliciousPath = path.join(repoRoot, 'skills', '..', '..', '..', '..', 'etc', 'passwd');
      expect(isWithinRoot(maliciousPath, repoRoot)).toBe(false);
    });

    it('rejects traversal disguised within valid-looking path', () => {
      const maliciousPath = path.resolve(repoRoot, '.salmonloop/skills/../../..');
      expect(isWithinRoot(maliciousPath, repoRoot)).toBe(false);
    });

    it('allows valid relative path that stays within root', async () => {
      const validPath = path.join(repoRoot, '.salmonloop', 'skills');
      expect(isWithinRoot(validPath, repoRoot)).toBe(true);
    });
  });

  describe('symlink escape attempt', () => {
    it('rejects symlink pointing outside repo root', async () => {
      const outsideDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'outside-'));
      try {
        await fsp.writeFile(path.join(outsideDir, 'secret.txt'), 'sensitive data');
        const linkPath = path.join(repoRoot, '.salmonloop', 'skills', 'evil-link');
        await fsp.symlink(outsideDir, linkPath, 'junction');

        expect(isWithinRoot(linkPath, repoRoot)).toBe(false);
      } finally {
        await fsp.rm(outsideDir, { recursive: true, force: true });
      }
    });

    it('rejects nested symlink chain that eventually escapes', async () => {
      const outsideDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'escape-'));
      try {
        // Create intermediate directory inside repo
        const intermediateDir = path.join(repoRoot, 'intermediate');
        await fsp.mkdir(intermediateDir, { recursive: true });

        // Create symlink inside repo pointing outside
        const linkPath = path.join(intermediateDir, 'escape-link');
        await fsp.symlink(outsideDir, linkPath, 'junction');

        expect(isWithinRoot(linkPath, repoRoot)).toBe(false);
      } finally {
        await fsp.rm(outsideDir, { recursive: true, force: true });
      }
    });

    it('allows symlink that resolves to a path within repo root', async () => {
      const targetDir = path.join(repoRoot, '.salmonloop', 'skills');
      const linkPath = path.join(repoRoot, 'skills-alias');
      await fsp.symlink(targetDir, linkPath, 'junction');

      expect(isWithinRoot(linkPath, repoRoot)).toBe(true);
    });
  });
});
