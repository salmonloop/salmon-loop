import { mkdtemp, rm, unlink } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { afterEach, describe, expect, it } from 'bun:test';

import { ChatSessionManager } from '../../../../src/core/session/manager.js';

const tempRoots: string[] = [];

async function createTempRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'salmon-loop-session-archive-'));
  tempRoots.push(root);
  return root;
}

describe('ChatSessionManager archive lifecycle', () => {
  afterEach(async () => {
    while (tempRoots.length > 0) {
      const root = tempRoots.pop();
      if (!root) continue;
      await rm(root, { recursive: true, force: true });
    }
  });

  it('lists archived sessions with metadata sorted by archive time', async () => {
    const repoPath = await createTempRepo();
    const manager = new ChatSessionManager(repoPath);
    await manager.init();

    const first = await manager.create('First Session');
    manager.addMessage({
      role: 'user',
      content: 'first request',
      timestamp: Date.now(),
    });
    await manager.save();
    await manager.archiveSession(first);

    await new Promise((resolve) => setTimeout(resolve, 25));

    const second = await manager.create('Second Session');
    manager.addMessage({
      role: 'user',
      content: 'second request',
      timestamp: Date.now(),
    });
    await manager.save();
    await manager.archiveSession(second);

    const archived = await manager.listArchivedSessions();

    expect(archived).toHaveLength(2);
    expect(archived[0]).toMatchObject({
      id: second.meta.id,
      name: 'Second Session',
    });
    expect(archived[1]).toMatchObject({
      id: first.meta.id,
      name: 'First Session',
    });
    expect(archived[0]!.archivedAt).toBeGreaterThanOrEqual(archived[1]!.archivedAt);
  });

  it('restores a session from archive and persists it back to active storage', async () => {
    const repoPath = await createTempRepo();
    const manager = new ChatSessionManager(repoPath);
    await manager.init();

    const session = await manager.create('Recover Me');
    manager.addMessage({
      role: 'user',
      content: 'please restore me',
      timestamp: Date.now(),
    });
    manager.addIteration({
      attempt: 1,
      plan: null,
      patch: null,
      contextSummary: 'Initial attempt',
    });
    await manager.save();
    await manager.archiveSession(session);

    const activeSessionFile = join(
      repoPath,
      '.salmonloop',
      'chat-sessions',
      `${session.meta.id}.json`,
    );
    await unlink(activeSessionFile);

    const restored = await manager.restoreFromArchive(session.meta.id.slice(0, 8));

    expect(restored).not.toBeNull();
    expect(restored?.meta.id).toBe(session.meta.id);
    expect(restored?.meta.name).toBe('Recover Me');
    expect(restored?.meta.repoPath).toBe(repoPath);
    expect(restored?.messages.length).toBeGreaterThan(0);

    const sessions = await manager.listSessions();
    expect(sessions.some((item) => item.id === session.meta.id)).toBe(true);
  });

  it('restores archived artifact state for later request rehydration', async () => {
    const repoPath = await createTempRepo();
    const manager = new ChatSessionManager(repoPath);
    await manager.init();

    const session = await manager.create('Artifact Restore');
    manager.mergeArtifactState({
      verifyArtifact: {
        handle: 's8p://artifact/verify-restored',
        mimeType: 'text/plain',
        sha256: 'verify-restored',
        size: 123,
      },
      recentReadArtifacts: [
        {
          path: 'src/restored.ts',
          artifact: {
            handle: 's8p://artifact/read-restored',
            mimeType: 'text/plain',
            sha256: 'read-restored',
            size: 45,
          },
        },
      ],
    });
    await manager.save();
    await manager.archiveSession(session);

    const restored = await manager.restoreFromArchive(session.meta.id);

    expect(restored).not.toBeNull();
    expect(manager.getArtifactState()).toEqual(
      expect.objectContaining({
        verifyArtifact: expect.objectContaining({
          handle: 's8p://artifact/verify-restored',
        }),
        recentReadArtifacts: [
          expect.objectContaining({
            path: 'src/restored.ts',
            artifact: expect.objectContaining({
              handle: 's8p://artifact/read-restored',
            }),
          }),
        ],
      }),
    );
  });

  it('returns null when archive id is not found', async () => {
    const repoPath = await createTempRepo();
    const manager = new ChatSessionManager(repoPath);
    await manager.init();

    const restored = await manager.restoreFromArchive('missing-archive-id');
    expect(restored).toBeNull();
  });
});
