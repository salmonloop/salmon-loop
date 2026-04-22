import { describe, expect, it } from 'bun:test';

import {
  resolveActiveChatFlowMode,
  resolveChatCheckpointStrategy,
} from '../../../src/cli/chat-flow.js';

describe('chat flow helpers', () => {
  it('falls back to autopilot when no session flow mode exists', () => {
    expect(resolveActiveChatFlowMode(undefined, undefined)).toBe('autopilot');
  });

  it('forces direct strategy for read-only modes', () => {
    expect(resolveChatCheckpointStrategy('review', 'worktree')).toBe('direct');
    expect(resolveChatCheckpointStrategy('answer', 'worktree')).toBe('direct');
  });

  it('recomputes mutable-mode defaults from the active flow mode', () => {
    expect(resolveChatCheckpointStrategy('patch', undefined)).toBe('worktree');
    expect(resolveChatCheckpointStrategy('autopilot', undefined)).toBe('direct');
  });

  it('preserves explicit strategy overrides for mutable modes', () => {
    expect(resolveChatCheckpointStrategy('patch', 'direct')).toBe('direct');
    expect(resolveChatCheckpointStrategy('autopilot', 'worktree')).toBe('worktree');
  });
});
