import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { ChatSessionManager } from '../../../../src/core/session/manager.js';

describe('ChatSessionManager Corruption Handling', () => {
  let testDir: string;
  let manager: ChatSessionManager;

  beforeEach(() => {
    testDir = join(tmpdir(), `session-corruption-bench-${Date.now()}`);
    mkdirSync(join(testDir, '.salmonloop', 'chat-sessions'), { recursive: true });
    manager = new ChatSessionManager(testDir);
  });

  afterEach(() => {
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  });

  it('handles corrupted JSON files gracefully in listSessions without crashing', async () => {
    const validSession = {
      meta: {
        id: 'valid-session-1',
        name: 'Valid Session',
        updatedAt: 1000,
      },
      messages: [],
      iterations: [],
    };
    writeFileSync(
      join(testDir, '.salmonloop', 'chat-sessions', 'valid-session-1.json'),
      JSON.stringify(validSession),
    );

    writeFileSync(
      join(testDir, '.salmonloop', 'chat-sessions', 'corrupt-session-1.json'),
      '{ invalid json',
    );

    const sessions = await manager.listSessions();

    expect(sessions.length).toBe(1);
    expect(sessions[0]!.id).toBe('valid-session-1');
  });

  it('returns empty array when all session files are corrupted', async () => {
    writeFileSync(join(testDir, '.salmonloop', 'chat-sessions', 'bad1.json'), 'not json');
    writeFileSync(join(testDir, '.salmonloop', 'chat-sessions', 'bad2.json'), '');

    const sessions = await manager.listSessions();
    expect(sessions).toHaveLength(0);
  });

  it('returns empty array when storage directory has no JSON files', async () => {
    writeFileSync(join(testDir, '.salmonloop', 'chat-sessions', 'readme.txt'), 'not a session');

    const sessions = await manager.listSessions();
    expect(sessions).toHaveLength(0);
  });
});
