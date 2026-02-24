/**
 * Tests for Incremental Updater.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';

import type { Context, RelatedFileContext } from '../../../types/index.js';
import {
  IncrementalUpdater,
  getIncrementalUpdater,
  resetIncrementalUpdater,
} from '../incremental-updater.js';

describe('IncrementalUpdater', () => {
  let updater: IncrementalUpdater;

  beforeEach(() => {
    updater = new IncrementalUpdater();
    resetIncrementalUpdater();
  });

  afterEach(() => {
    resetIncrementalUpdater();
  });

  const createMockContext = (files: string[]): Context => ({
    repoPath: '/test/repo',
    primaryText: 'Primary content',
    relatedFiles: files.map(
      (path) =>
        ({
          path,
          content: `Content of ${path}`,
          kind: 'import' as const,
          mode: 'full' as const,
        }) satisfies RelatedFileContext,
    ),
    rgSnippets: [],
    gitDiff: '',
    stagedDiff: '',
    unstagedDiff: '',
    untrackedDiff: '',
  });

  describe('computeDiff', () => {
    it('should detect added files', () => {
      const ctx1 = createMockContext(['file1.ts']);
      updater.computeDiff(ctx1);

      const ctx2 = createMockContext(['file1.ts', 'file2.ts', 'file3.ts']);
      const diff = updater.computeDiff(ctx2);

      expect(diff.addedFiles).toContain('file2.ts');
      expect(diff.addedFiles).toContain('file3.ts');
    });

    it('should detect removed files', () => {
      const ctx1 = createMockContext(['file1.ts', 'file2.ts']);
      updater.computeDiff(ctx1);

      const ctx2 = createMockContext(['file1.ts']);
      const diff = updater.computeDiff(ctx2);

      expect(diff.removedFiles).toContain('file2.ts');
    });

    it('should detect modified files', () => {
      const ctx1 = createMockContext(['file1.ts']);
      updater.computeDiff(ctx1);

      const ctx2: Context = {
        repoPath: '/test/repo',
        primaryText: 'Primary content',
        relatedFiles: [
          {
            path: 'file1.ts',
            content: 'Modified content',
            kind: 'import',
            mode: 'full',
          },
        ],
        rgSnippets: [],
        gitDiff: '',
        stagedDiff: '',
        unstagedDiff: '',
        untrackedDiff: '',
      };
      const diff = updater.computeDiff(ctx2);

      expect(diff.modifiedFiles).toContain('file1.ts');
    });

    it('should detect primary text change', () => {
      const ctx1: Context = {
        repoPath: '/test/repo',
        primaryText: 'Old primary',
        relatedFiles: [],
        rgSnippets: [],
        gitDiff: '',
        stagedDiff: '',
        unstagedDiff: '',
        untrackedDiff: '',
      };
      updater.computeDiff(ctx1);

      const ctx2: Context = {
        ...ctx1,
        primaryText: 'New primary',
      };
      const diff = updater.computeDiff(ctx2);

      expect(diff.primaryChanged).toBe(true);
    });

    it('should return all as new for first context', () => {
      const ctx = createMockContext(['file1.ts', 'file2.ts']);
      const diff = updater.computeDiff(ctx);

      expect(diff.addedFiles).toHaveLength(2);
      expect(diff.primaryChanged).toBe(true);
    });
  });

  describe('Token tracking', () => {
    it('should track token count', () => {
      updater.setTokenCount(1000);
      expect(updater.getPreviousTokenCount()).toBe(1000);
    });
  });

  describe('Reset', () => {
    it('should reset state', () => {
      const ctx = createMockContext(['file1.ts']);
      updater.computeDiff(ctx);

      updater.reset();

      expect(updater.getPreviousContext()).toBeNull();
      expect(updater.getPreviousTokenCount()).toBe(0);
    });
  });
});

describe('Global instance', () => {
  it('should return singleton', () => {
    const instance1 = getIncrementalUpdater();
    const instance2 = getIncrementalUpdater();

    expect(instance1).toBe(instance2);
  });

  it('should reset singleton', () => {
    const instance1 = getIncrementalUpdater();
    resetIncrementalUpdater();
    const instance2 = getIncrementalUpdater();

    expect(instance1).not.toBe(instance2);
  });
});
