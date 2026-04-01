import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { afterEach, describe, expect, it } from 'bun:test';

import { SessionCompressor } from '../../../../src/core/session/compression.js';
import { SessionArchiver } from '../../../../src/core/session/pruning-strategy.js';
import type { ChatSession } from '../../../../src/core/session/types.js';

const tempRoots: string[] = [];

async function createTempRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'salmon-loop-session-archiver-'));
  tempRoots.push(root);
  return root;
}

function createSession(repoPath: string): ChatSession {
  const now = Date.now();
  return {
    meta: {
      id: 'archiver-session-id',
      name: 'Archive Candidate',
      repoPath,
      createdAt: now - 10_000,
      updatedAt: now,
      totalIterations: 1,
      successfulIterations: 1,
      totalTokens: { input: 100, output: 200 },
      snapshots: [],
    },
    messages: [
      {
        id: 'msg-1',
        role: 'user',
        content: 'please archive and restore this session',
        timestamp: now,
      },
    ],
    iterations: [
      {
        id: 'iter-1',
        attempt: 1,
        plan: null,
        patch: null,
        contextSummary: 'First attempt summary',
      },
    ],
  };
}

describe('SessionArchiver', () => {
  afterEach(async () => {
    while (tempRoots.length > 0) {
      const root = tempRoots.pop();
      if (!root) continue;
      await rm(root, { recursive: true, force: true });
    }
  });

  it('creates and restores archive data', async () => {
    const repoPath = await createTempRepo();
    const session = createSession(repoPath);
    const compressor = new SessionCompressor();
    const archiver = new SessionArchiver(repoPath);
    const compressed = await compressor.compressToBinary(session, 42);

    const archiveId = await archiver.createArchive(session, compressed);
    const restored = await archiver.restoreFromArchive(archiveId);

    expect(restored).not.toBeNull();
    expect(restored?.meta.id).toBe(session.meta.id);
    expect(restored?.meta.name).toBe(session.meta.name);
    expect(restored?.meta.repoPath).toBe(repoPath);
    expect(restored?.messages.length).toBeGreaterThan(0);
  });

  it('returns null when archive file is missing', async () => {
    const repoPath = await createTempRepo();
    const archiver = new SessionArchiver(repoPath);

    const restored = await archiver.restoreFromArchive('missing-archive-id');
    expect(restored).toBeNull();
  });
});
