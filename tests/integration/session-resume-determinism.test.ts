import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { afterEach, describe, expect, it } from 'bun:test';

import { ChatSessionManager } from '../../src/core/session/manager.js';

const tempRoots: string[] = [];

async function createTempRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'salmon-loop-resume-determinism-'));
  tempRoots.push(root);
  return root;
}

describe('Resume repair determinism (integration)', () => {
  afterEach(async () => {
    while (tempRoots.length > 0) {
      const root = tempRoots.pop();
      if (!root) continue;
      await rm(root, { recursive: true, force: true });
    }
  });

  it('restores byte-stable runtime context from identical archive input', async () => {
    const repoPath = await createTempRepo();
    const manager = new ChatSessionManager(repoPath);
    await manager.init();

    const session = await manager.create('Deterministic Resume');
    manager.addMessage({
      role: 'user',
      content: 'Please resume deterministically.',
      timestamp: 1_710_000_000_001,
    });
    manager.addMessage({
      role: 'assistant',
      content: 'Acknowledged.',
      timestamp: 1_710_000_000_002,
    });
    manager.addIteration({
      attempt: 1,
      plan: null,
      patch: null,
      contextSummary: 'Attempt 1',
    });
    manager.mergeArtifactState({
      verifyArtifact: {
        handle: 's8p://artifact/verify-1',
        mimeType: 'text/plain',
        sha256: 'verify-sha',
        size: 12,
      },
    });
    manager.freezeReplacementDecision({
      toolResultId: 'tool-result-1',
      decision: 'replaced',
      preview: 'preview text',
      sourceArtifactHandle: 's8p://artifact/verify-1',
      frozenAt: 1_710_000_000_003,
    });
    await manager.save();
    await manager.archiveSession(session);

    const captureRestore = async (fixedNow: number) => {
      const originalNow = Date.now;
      Date.now = () => fixedNow;
      try {
        const restored = await manager.restoreFromArchive(session.meta.id);
        expect(restored).not.toBeNull();
        return JSON.stringify({
          meta: {
            id: restored?.meta.id,
            name: restored?.meta.name,
            repoPath: restored?.meta.repoPath,
            createdAt: restored?.meta.createdAt,
            updatedAt: restored?.meta.updatedAt,
            totalIterations: restored?.meta.totalIterations,
            successfulIterations: restored?.meta.successfulIterations,
            totalTokens: restored?.meta.totalTokens,
            artifactState: restored?.meta.artifactState,
            replacementState: restored?.meta.replacementState,
            resumeRepairState: restored?.meta.resumeRepairState,
          },
          messages: restored?.messages,
          iterations: restored?.iterations,
        });
      } finally {
        Date.now = originalNow;
      }
    };

    const first = await captureRestore(1_720_000_000_000);
    const second = await captureRestore(1_720_000_000_000);
    expect(second).toBe(first);
  });
});
