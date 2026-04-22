import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { afterEach, describe, expect, it } from 'bun:test';

import { ChatSessionManager } from '../../src/core/session/manager.js';

const tempRoots: string[] = [];

async function createTempRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'salmon-loop-session-flow-resume-'));
  tempRoots.push(root);
  return root;
}

describe('Session flow mode resume (integration)', () => {
  afterEach(async () => {
    while (tempRoots.length > 0) {
      const root = tempRoots.pop();
      if (!root) continue;
      await rm(root, { recursive: true, force: true });
    }
  });

  it('restores chat flow mode after resume', async () => {
    const repoPath = await createTempRepo();
    const manager = new ChatSessionManager(repoPath);
    await manager.init();
    const session = await manager.create('Flow Resume');

    manager.updateChatFlowMode('debug');
    await manager.save();

    const resumedManager = new ChatSessionManager(repoPath);
    await resumedManager.init();
    const resumed = await resumedManager.resumeSession(session.meta.id);

    expect(resumed.meta.chatState?.flowMode).toBe('debug');
    expect(resumedManager.getChatFlowMode()).toBe('debug');
  });
});
