import { describe, expect, it } from 'bun:test';

import {
  extractDiffFiles,
  detectConflicts,
  generateSubAgentSummary,
  formatSubAgentSummary,
} from '../../../src/core/sub-agent/summary.js';
import type { SubAgentResult } from '../../../src/core/sub-agent/types.js';

function makeResult(success: boolean, patch?: string): SubAgentResult {
  return {
    agent_ref: 'test-agent',
    success,
    summary: success ? 'done' : 'failed',
    tokenUsage: 100,
    finalPatch: patch,
    attempts: 1,
    logs: [],
    reason: success ? '' : 'test failure',
    reasonCode: success ? 'SUCCESS' : 'LOOP_FAILED',
  };
}

describe('SubAgent Summary', () => {
  describe('extractDiffFiles', () => {
    it('should extract files from unified diff headers', () => {
      const patch = [
        'diff --git a/src/foo.ts b/src/foo.ts',
        '--- a/src/foo.ts',
        '+++ b/src/foo.ts',
        '@@ -1 +1 @@',
        '-old',
        '+new',
        'diff --git a/src/bar.ts b/src/bar.ts',
        '--- a/src/bar.ts',
        '+++ b/src/bar.ts',
        '@@ -1 +1 @@',
        '-old',
        '+new',
      ].join('\n');

      expect(extractDiffFiles(patch)).toEqual(['src/foo.ts', 'src/bar.ts']);
    });

    it('should return empty array for empty patch', () => {
      expect(extractDiffFiles('')).toEqual([]);
    });
  });

  describe('detectConflicts', () => {
    it('should detect when two agents modify the same file', () => {
      const patch1 = '--- a/src/foo.ts\n+++ b/src/foo.ts\n@@ -1 +1 @@\n-a\n+b';
      const patch2 = '--- a/src/foo.ts\n+++ b/src/foo.ts\n@@ -1 +1 @@\n-a\n+c';
      const patch3 = '--- a/src/bar.ts\n+++ b/src/bar.ts\n@@ -1 +1 @@\n-x\n+y';

      const results = [
        { agentId: 'agent-1', result: makeResult(true, patch1) },
        { agentId: 'agent-2', result: makeResult(true, patch2) },
        { agentId: 'agent-3', result: makeResult(true, patch3) },
      ];

      const conflicts = detectConflicts(results);
      expect(conflicts).toHaveLength(1);
      expect(conflicts[0].file).toBe('src/foo.ts');
      expect(conflicts[0].agents).toEqual(['agent-1', 'agent-2']);
    });

    it('should return no conflicts when files do not overlap', () => {
      const patch1 = '--- a/src/foo.ts\n+++ b/src/foo.ts\n@@ -1 +1 @@\n-a\n+b';
      const patch2 = '--- a/src/bar.ts\n+++ b/src/bar.ts\n@@ -1 +1 @@\n-x\n+y';

      const results = [
        { agentId: 'agent-1', result: makeResult(true, patch1) },
        { agentId: 'agent-2', result: makeResult(true, patch2) },
      ];

      expect(detectConflicts(results)).toHaveLength(0);
    });

    it('should handle agents with no patches', () => {
      const results = [
        { agentId: 'agent-1', result: makeResult(true) },
        { agentId: 'agent-2', result: makeResult(false) },
      ];

      expect(detectConflicts(results)).toHaveLength(0);
    });
  });

  describe('generateSubAgentSummary', () => {
    it('should count successes and failures', () => {
      const results = [
        { agentId: 'a1', result: makeResult(true, '--- a/f.ts\n+++ b/f.ts\n@@ -1 +1 @@\n-a\n+b') },
        { agentId: 'a2', result: makeResult(false) },
        { agentId: 'a3', result: makeResult(true) },
      ];

      const summary = generateSubAgentSummary(results);
      expect(summary.totalAgents).toBe(3);
      expect(summary.succeeded).toBe(2);
      expect(summary.failed).toBe(1);
      expect(summary.totalTokens).toBe(300);
      expect(summary.changedFiles).toEqual(['f.ts']);
    });
  });

  describe('formatSubAgentSummary', () => {
    it('should produce readable output', () => {
      const summary = {
        totalAgents: 2,
        succeeded: 1,
        failed: 1,
        conflicts: [{ file: 'src/foo.ts', agents: ['a1', 'a2'] }],
        totalTokens: 500,
        changedFiles: ['src/foo.ts', 'src/bar.ts'],
      };

      const output = formatSubAgentSummary(summary);
      expect(output).toContain('Total: 2');
      expect(output).toContain('Succeeded: 1');
      expect(output).toContain('Failed: 1');
      expect(output).toContain('Conflicts Detected');
      expect(output).toContain('src/foo.ts');
      expect(output).toContain('a1, a2');
    });
  });
});
