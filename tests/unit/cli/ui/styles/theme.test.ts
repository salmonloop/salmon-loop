import { describe, expect, it } from 'bun:test';

import type { MessageType } from '../../../../../src/cli/ui/store/types.js';
import {
  MESSAGE_STYLES,
  shouldShowSeparator,
  COLORS,
} from '../../../../../src/cli/ui/styles/theme.js';

describe('theme.ts', () => {
  describe('MESSAGE_STYLES', () => {
    it('should have styles for all message types', () => {
      // Create a mock type representing all expected message types from the code
      const types: MessageType[] = [
        'assistant',
        'assistant_stream',
        'todo_card',
        'error',
        'warning',
        'user',
        'tool_result',
        'checkpoint',
        'interrupt',
        'system',
        'queue',
        'thinking',
        'explore_step',
        'plan_step',
        'patch_step',
        'apply_step',
        'validate_step',
        'verify_step',
        'preflight_step',
        'context_step',
        'ast_validate_step',
        'rollback_step',
        'shrink_step',
        'review_step',
        'report_step',
        'analyze_issues_step',
        'tool_call',
        'welcome',
      ];

      for (const type of types) {
        expect(MESSAGE_STYLES[type]).toBeDefined();
        expect(MESSAGE_STYLES[type]).toHaveProperty('inkColor');
        expect(MESSAGE_STYLES[type]).toHaveProperty('hasBorder');
        expect(MESSAGE_STYLES[type]).toHaveProperty('marginBottom');
        // label can be string | null
        const label = MESSAGE_STYLES[type].label;
        expect(typeof label === 'string' || label === null).toBe(true);
      }
    });

    it('should configure level 1 messages with borders and specific properties', () => {
      const level1Types: MessageType[] = [
        'assistant',
        'assistant_stream',
        'todo_card',
        'error',
        'warning',
      ];
      for (const type of level1Types) {
        const style = MESSAGE_STYLES[type];
        expect(style.hasBorder).toBe(true);
        expect(style.marginBottom).toBe(1);
        expect(style.label).not.toBeNull();
      }
    });

    it('should configure specific properties for system messages', () => {
      const style = MESSAGE_STYLES['system'];
      expect(style.inkColor).toBe(COLORS.text.muted);
      expect(style.label).toBeNull();
      expect(style.hasBorder).toBe(false);
      expect(style.marginBottom).toBe(0);
    });
  });

  describe('shouldShowSeparator', () => {
    it('should return false if nextType is undefined', () => {
      expect(shouldShowSeparator('user', undefined)).toBe(false);
    });

    it('should always return true if current or next type is an emphasis type', () => {
      // emphasis types: 'user', 'assistant', 'assistant_stream', 'todo_card'
      expect(shouldShowSeparator('user', 'system')).toBe(true);
      expect(shouldShowSeparator('system', 'assistant')).toBe(true);
      expect(shouldShowSeparator('assistant_stream', 'assistant_stream')).toBe(true);
      expect(shouldShowSeparator('todo_card', 'todo_card')).toBe(true);
    });

    it('should return false between two lightweight messages', () => {
      // lightweight messages don't have a label
      expect(shouldShowSeparator('system', 'queue')).toBe(false);
      expect(shouldShowSeparator('tool_call', 'system')).toBe(false);
    });

    it('should return true if message types are different (and not lightweight)', () => {
      expect(shouldShowSeparator('tool_result', 'checkpoint')).toBe(true);
    });

    it('should return false if message types are the same (and not lightweight/emphasis)', () => {
      expect(shouldShowSeparator('tool_result', 'tool_result')).toBe(false);
      expect(shouldShowSeparator('checkpoint', 'checkpoint')).toBe(false);
    });
  });
});
