import { describe, expect, it, mock } from 'bun:test';

// Mock chalk before anything else
mock.module('chalk', () => {
  const styler = (s: any) => s;
  styler.bold = (s: any) => s;
  return {
    default: {
      hex: () => styler,
    },
  };
});

// We need to use dynamic import because theme.ts uses chalk at the top level
const { shouldShowSeparator } = await import('../../../../../src/cli/ui/styles/theme.js');
import type { MessageType } from '../../../../../src/cli/ui/store/types.js';

describe('shouldShowSeparator', () => {
  it('should return false if nextType is undefined', () => {
    expect(shouldShowSeparator('user', undefined)).toBe(false);
  });

  it('should return true if current message is an emphasis type', () => {
    expect(shouldShowSeparator('assistant', 'system')).toBe(true);
    expect(shouldShowSeparator('user', 'system')).toBe(true);
    expect(shouldShowSeparator('todo_card', 'system')).toBe(true);
  });

  it('should return true if next message is an emphasis type', () => {
    expect(shouldShowSeparator('system', 'assistant')).toBe(true);
    expect(shouldShowSeparator('system', 'user')).toBe(true);
    expect(shouldShowSeparator('system', 'todo_card')).toBe(true);
  });

  it('should return false between lightweight messages (no labels)', () => {
    expect(shouldShowSeparator('system', 'queue')).toBe(false);
    expect(shouldShowSeparator('queue', 'system')).toBe(false);
    expect(shouldShowSeparator('system', 'tool_call')).toBe(false);
  });

  it('should return true when types change and at least one has a label', () => {
    expect(shouldShowSeparator('thinking', 'checkpoint')).toBe(true);
    expect(shouldShowSeparator('plan_step', 'explore_step')).toBe(true);
  });

  it('should return false when types are the same even if they have labels', () => {
    expect(shouldShowSeparator('thinking', 'thinking')).toBe(false);
    expect(shouldShowSeparator('plan_step', 'plan_step')).toBe(false);
  });

  it('should return false when types are the same and have no labels', () => {
    expect(shouldShowSeparator('system', 'system')).toBe(false);
    expect(shouldShowSeparator('tool_call', 'tool_call')).toBe(false);
  });

  it('should return true if style for a type is missing (fallback)', () => {
    // Cast to any to test missing style scenario
    expect(shouldShowSeparator('non_existent' as MessageType, 'system' as MessageType)).toBe(true);
    expect(shouldShowSeparator('system' as MessageType, 'non_existent' as MessageType)).toBe(true);
  });
});
