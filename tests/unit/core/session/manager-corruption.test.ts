import { describe, expect, it, mock, beforeEach, afterEach } from 'bun:test';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { ChatSessionManager } from '../../../../src/core/session/manager.js';
import { setLogger } from '../../../../src/core/observability/logger.js';

describe('ChatSessionManager Corruption Handling', () => {
  let testDir: string;
  let manager: ChatSessionManager;
  let mockLogger: any;

  beforeEach(() => {
    testDir = join(tmpdir(), `session-corruption-bench-${Date.now()}`);
    mkdirSync(join(testDir, '.salmonloop', 'chat-sessions'), { recursive: true });

    mockLogger = {
      info: mock(),
      warn: mock(),
      error: mock(),
      debug: mock(),
    };
    setLogger(mockLogger);

    manager = new ChatSessionManager(testDir);
  });

  afterEach(() => {
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {}
  });

  it('handles corrupted JSON files gracefully in listSessions without crashing', async () => {
    // Write valid session
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
      JSON.stringify(validSession)
    );

    // Write corrupted session
    writeFileSync(
      join(testDir, '.salmonloop', 'chat-sessions', 'corrupt-session-1.json'),
      '{ invalid json'
    );

    const sessions = await manager.listSessions();

    expect(sessions.length).toBe(1);
    expect(sessions[0].id).toBe('valid-session-1');
    expect(mockLogger.warn).toHaveBeenCalled();
    const warnCall = mockLogger.warn.mock.calls[0][0];
    expect(warnCall).toContain('Failed to list session file corrupt-session-1.json');
  });
});
