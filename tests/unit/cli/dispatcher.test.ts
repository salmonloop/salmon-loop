import { describe, it, expect, vi } from 'vitest';

import { CommandDispatcher } from '../../../src/cli/commands/dispatcher.js';
import { ChatSessionManager } from '../../../src/core/session/manager.js';
import { LoopEvent } from '../../../src/core/types/index.js';

// Mock dependencies
const mockEmit = vi.fn();
const mockSessionManager = {
  getCurrent: vi.fn(),
  addMessage: vi.fn(),
  addIteration: vi.fn(),
  save: vi.fn(),
} as unknown as ChatSessionManager;

describe('CommandDispatcher', () => {
  const dispatcher = new CommandDispatcher();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should execute a valid command', async () => {
    // /help is a valid command in registry
    const result = await dispatcher.dispatch('/help', {
      emit: mockEmit,
      sessionManager: mockSessionManager,
      dispatch: vi.fn(),
    });

    expect(result).toEqual({ type: 'executed' });
    // Verify emit was called by the command (help command emits log)
    expect(mockEmit).toHaveBeenCalled();
    const lastCall = mockEmit.mock.lastCall?.[0] as LoopEvent;
    expect(lastCall?.type).toBe('log');
    expect((lastCall as any).message).toContain('Available Commands');
  });

  it('should block an unknown slash command', async () => {
    const result = await dispatcher.dispatch('/unknown_cmd', {
      emit: mockEmit,
      sessionManager: mockSessionManager,
      dispatch: vi.fn(),
    });

    expect(result).toEqual({
      type: 'blocked',
      reason: expect.stringContaining('Unknown command: /unknown_cmd'),
    });

    // Verify error log was emitted
    expect(mockEmit).toHaveBeenCalled();
    const lastCall = mockEmit.mock.lastCall?.[0] as LoopEvent;

    if (lastCall.type === 'log') {
      expect(lastCall.level).toBe('error');
    } else {
      throw new Error('Expected log event');
    }
  });

  it('should block a slash command with spaces before it', async () => {
    const result = await dispatcher.dispatch('  /verify ', {
      emit: mockEmit,
      sessionManager: mockSessionManager,
      dispatch: vi.fn(),
    });

    // /verify is not in the default registry in the code I read earlier (it had exit, quit, status, clear, history, help)
    // If it's not in registry, it should be blocked.
    // If it WAS in registry, it should be executed.
    // Let's use a definitely unknown one to test trimming + blocking logic

    expect(result).toEqual({
      type: 'blocked',
      reason: expect.stringContaining('Unknown command: /verify'),
    });
  });

  it('should allow normal text input', async () => {
    const result = await dispatcher.dispatch('hello world', {
      emit: mockEmit,
      sessionManager: mockSessionManager,
      dispatch: vi.fn(),
    });

    expect(result).toEqual({
      type: 'continue',
      trimmedInput: 'hello world',
    });
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it('should allow text that contains a slash but does not start with it', async () => {
    const result = await dispatcher.dispatch('check src/cli/index.ts', {
      emit: mockEmit,
      sessionManager: mockSessionManager,
      dispatch: vi.fn(),
    });

    expect(result).toEqual({
      type: 'continue',
      trimmedInput: 'check src/cli/index.ts',
    });
  });

  it('should handle empty input', async () => {
    const result = await dispatcher.dispatch('', {
      emit: mockEmit,
      sessionManager: mockSessionManager,
      dispatch: vi.fn(),
    });

    expect(result).toEqual({
      type: 'continue',
      trimmedInput: '',
    });
  });

  it('should emit usage error for /snapshot restore without hash', async () => {
    const result = await dispatcher.dispatch('/snapshot restore', {
      emit: mockEmit,
      sessionManager: mockSessionManager,
      dispatch: vi.fn(),
    });

    expect(result).toEqual({ type: 'executed' });
    expect(mockEmit).toHaveBeenCalled();

    const lastCall = mockEmit.mock.lastCall?.[0] as LoopEvent;
    expect(lastCall?.type).toBe('log');
    if (lastCall.type !== 'log') throw new Error('Expected log event');
    expect(lastCall.level).toBe('error');
    expect(lastCall.message).toContain('Usage: /snapshot restore <hash>');
  });
});
