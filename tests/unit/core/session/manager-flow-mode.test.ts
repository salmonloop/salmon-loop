import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { afterEach, describe, expect, it } from 'bun:test';

import { ChatSessionManager } from '../../../../src/core/session/manager.js';

const tempRoots: string[] = [];

async function createTempRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'salmon-loop-session-flow-mode-'));
  tempRoots.push(root);
  return root;
}

function getSessionFilePath(repoPath: string, sessionId: string): string {
  return join(repoPath, '.salmonloop', 'chat-sessions', `${sessionId}.json`);
}

describe('ChatSessionManager flow mode', () => {
  afterEach(async () => {
    while (tempRoots.length > 0) {
      const root = tempRoots.pop();
      if (!root) continue;
      await rm(root, { recursive: true, force: true });
    }
  });

  it('persists chat flow mode across save and reload', async () => {
    const repoPath = await createTempRepo();
    const manager = new ChatSessionManager(repoPath);
    await manager.init();
    const session = await manager.create('flow-session');

    manager.updateChatFlowMode('review');
    await manager.save();

    const persisted = JSON.parse(
      await readFile(getSessionFilePath(repoPath, session.meta.id), 'utf8'),
    ) as {
      meta: {
        chatState?: {
          flowMode?: string;
        };
      };
    };

    expect(persisted.meta.chatState).toEqual({ flowMode: 'review' });

    const reloaded = new ChatSessionManager(repoPath);
    await reloaded.init();
    const loaded = await reloaded.loadLast();

    expect(loaded).not.toBeNull();
    expect(loaded?.meta.chatState?.flowMode).toBe('review');
    expect(reloaded.getChatFlowMode()).toBe('review');
  });

  it('normalizes invalid stored chat flow mode to undefined and keeps legacy sessions empty', async () => {
    const repoPath = await createTempRepo();
    const manager = new ChatSessionManager(repoPath);
    await manager.init();
    const session = await manager.create('legacy-flow-session');

    expect(manager.getChatFlowMode()).toBeUndefined();

    const filePath = getSessionFilePath(repoPath, session.meta.id);
    const createdSession = JSON.parse(await readFile(filePath, 'utf8')) as {
      meta: {
        chatState?: {
          flowMode?: string;
        };
      };
    };

    expect(createdSession.meta.chatState).toBeUndefined();

    const legacyReload = new ChatSessionManager(repoPath);
    await legacyReload.init();
    const legacyLoaded = await legacyReload.loadLast();

    expect(legacyLoaded).not.toBeNull();
    expect(legacyLoaded?.meta.chatState).toBeUndefined();
    expect(legacyReload.getChatFlowMode()).toBeUndefined();

    createdSession.meta.chatState = { flowMode: 'invalid-mode' };
    await writeFile(filePath, JSON.stringify(createdSession, null, 2));

    const invalidReload = new ChatSessionManager(repoPath);
    await invalidReload.init();
    const invalidLoaded = await invalidReload.loadLast();

    expect(invalidLoaded).not.toBeNull();
    expect(invalidLoaded?.meta.chatState?.flowMode).toBeUndefined();
    expect(invalidReload.getChatFlowMode()).toBeUndefined();
  });
});
