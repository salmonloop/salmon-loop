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
      // Use Object.keys to dynamically check all registered message types
      const types = Object.keys(MESSAGE_STYLES) as MessageType[];

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
        expect(style.inkColor).toBeDefined(); // Assertion for inkColor added for consistency
      }
    });

    it('should configure specific properties for system messages', () => {
      const style = MESSAGE_STYLES['system'];
      expect(style.inkColor).toBe(COLORS.text.muted);
      expect(style.label).toBeNull();
      expect(style.hasBorder).toBe(false);
      expect(style.marginBottom).toBe(0);
    });

    it('should configure specific properties for welcome message', () => {
      // Testing welcome message which has no label but a marginBottom of 1
      const style = MESSAGE_STYLES['welcome'];
      expect(style.inkColor).toBe(COLORS.text.muted);
      expect(style.label).toBeNull();
      expect(style.hasBorder).toBe(false);
      expect(style.marginBottom).toBe(1);
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

    it('should handle welcome message as lightweight message', () => {
      expect(shouldShowSeparator('welcome', 'system')).toBe(false);
      expect(shouldShowSeparator('system', 'welcome')).toBe(false);
    });

    it('should return true if message types are different (and not lightweight)', () => {
      expect(shouldShowSeparator('tool_result', 'checkpoint')).toBe(true);
    });

    it('should return false if message types are the same (and not lightweight/emphasis)', () => {
      expect(shouldShowSeparator('tool_result', 'tool_result')).toBe(false);
      expect(shouldShowSeparator('checkpoint', 'checkpoint')).toBe(false);
    });

    it('should return true if currentStyle or nextStyle is missing', () => {
      // Simulate missing styles by passing invalid types (using any cast for testing boundary logic)
      expect(shouldShowSeparator('user', 'invalid_type' as any)).toBe(true);
      expect(shouldShowSeparator('invalid_type' as any, 'system')).toBe(true);
      expect(shouldShowSeparator('invalid_type' as any, 'another_invalid' as any)).toBe(true);
    });
  });
});
