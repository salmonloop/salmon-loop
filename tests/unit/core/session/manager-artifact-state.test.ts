import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { afterEach, describe, expect, it } from 'bun:test';

import { ChatSessionManager } from '../../../../src/core/session/manager.js';

const tempRoots: string[] = [];

async function createTempRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'salmon-loop-session-artifact-'));
  tempRoots.push(root);
  return root;
}

describe('ChatSessionManager artifact state', () => {
  afterEach(async () => {
    while (tempRoots.length > 0) {
      const root = tempRoots.pop();
      if (!root) continue;
      await rm(root, { recursive: true, force: true });
    }
  });

  it('persists artifact state across save and reload', async () => {
    const repoPath = await createTempRepo();
    const manager = new ChatSessionManager(repoPath);
    await manager.init();
    await manager.create('artifact-session');

    manager.mergeArtifactState({
      verifyArtifact: {
        handle: 's8p://artifact/verify-1',
        mimeType: 'text/plain',
        sha256: 'verify-1',
        size: 100,
      },
      toolResultPreviewArtifacts: [
        {
          label: 'Tool result preview: web.search',
          artifact: {
            handle: 's8p://artifact/preview-1',
            mimeType: 'application/json',
            sha256: 'preview-1',
            size: 256,
          },
        },
      ],
    });
    manager.freezeReplacementDecision({
      toolResultId: 'tool-1',
      decision: 'replaced',
      preview: 'preview payload',
      sourceArtifactHandle: 's8p://artifact/preview-1',
      frozenAt: 10,
    });
    await manager.save();

    const reloaded = new ChatSessionManager(repoPath);
    await reloaded.init();
    const loaded = await reloaded.loadLast();

    expect(loaded).not.toBeNull();
    expect(reloaded.getArtifactState()).toEqual(
      expect.objectContaining({
        verifyArtifact: expect.objectContaining({ handle: 's8p://artifact/verify-1' }),
        toolResultPreviewArtifacts: [
          expect.objectContaining({
            label: 'Tool result preview: web.search',
            artifact: expect.objectContaining({ handle: 's8p://artifact/preview-1' }),
          }),
        ],
      }),
    );
    expect(reloaded.getReplacementState()).toEqual(
      expect.objectContaining({
        schemaVersion: 1,
        entries: expect.objectContaining({
          'tool-1': expect.objectContaining({
            decision: 'replaced',
            sourceArtifactHandle: 's8p://artifact/preview-1',
          }),
        }),
      }),
    );
  });
});
