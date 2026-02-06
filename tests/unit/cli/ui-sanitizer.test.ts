import { UI_CONFIG } from '../../../src/cli/ui/config.js';
import { sanitizeMessage } from '../../../src/cli/ui/utils/sanitizer.js';

describe('ui sanitizeMessage', () => {
  it('keeps long ai messages up to conversation limit', () => {
    const content = 'a'.repeat(UI_CONFIG.LOG_CHAR_LIMIT + 200);
    const sanitized = sanitizeMessage({ type: 'ai', content });

    expect(sanitized).toBe(content);
  });

  it('truncates long system logs to log limit', () => {
    const content = 'b'.repeat(UI_CONFIG.LOG_CHAR_LIMIT + 200);
    const sanitized = sanitizeMessage({ type: 'system', content });

    expect(sanitized.length).toBe(UI_CONFIG.LOG_CHAR_LIMIT);
    expect(sanitized.endsWith('...')).toBe(true);
  });
});
