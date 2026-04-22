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

  it('preserves configured strategy for mutable modes', () => {
    expect(resolveChatCheckpointStrategy('patch', 'worktree')).toBe('worktree');
    expect(resolveChatCheckpointStrategy('autopilot', 'direct')).toBe('direct');
  });
});
