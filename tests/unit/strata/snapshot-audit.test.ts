import { describe, expect, it } from 'bun:test';

import {
  classifyGitFailureHint,
  extractSafeSnapshotErrorSummary,
  hashRepoPathForAudit,
} from '../../../src/core/strata/checkpoint/snapshot-audit.js';

describe('snapshot audit helpers', () => {
  it('classifies common git failures into stable hint codes', () => {
    expect(
      classifyGitFailureHint({
        message: 'git failed',
        stderr: 'fatal: Unable to create index.lock: File exists',
        command: 'write-tree',
      }),
    ).toBe('GIT_INDEX_LOCKED');

    expect(
      classifyGitFailureHint({
        message: 'fatal: not a git repository (or any parent up to mount point)',
        stderr: '',
        command: 'rev-parse --is-inside-work-tree',
      }),
    ).toBe('GIT_NOT_REPOSITORY');
  });

  it('extracts only safe summary fields and fingerprints', () => {
    const summary = extractSafeSnapshotErrorSummary({
      name: 'GitError',
      code: 'GIT_ERROR',
      message: 'fatal: git-write-tree: error building trees',
      stderr: 'fatal: git-write-tree: error building trees',
      command: 'write-tree',
      writeTreeAttempts: 3,
    });

    expect(summary).toMatchObject({
      errorName: 'GitError',
      errorCode: 'GIT_ERROR',
      errorHintCode: 'GIT_TREE_BUILD_FAILED',
      writeTreeAttempts: 3,
    });
    expect(summary.errorFingerprint).toMatch(/^[a-f0-9]{16}$/);
    expect(summary.stderrFingerprint).toMatch(/^[a-f0-9]{16}$/);
    expect(summary.commandFingerprint).toMatch(/^[a-f0-9]{16}$/);
  });

  it('hashes repo path into fixed-size audit-safe digest', () => {
    const hash1 = hashRepoPathForAudit('/repo/path');
    const hash2 = hashRepoPathForAudit('/repo/path');
    const hash3 = hashRepoPathForAudit('/repo/other');

    expect(hash1).toBe(hash2);
    expect(hash1).not.toBe(hash3);
    expect(hash1).toMatch(/^[a-f0-9]{16}$/);
  });
});
