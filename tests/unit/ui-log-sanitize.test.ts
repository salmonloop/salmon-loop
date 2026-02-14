import { sanitizeUiLogMessage } from '../../src/core/observability/ui-log-sanitize.js';

describe('sanitizeUiLogMessage', () => {
  it('hides technical dump hints', () => {
    const msg =
      "APICallError: Service Unavailable { requestBodyValues: { model: 'x' }, responseBody: 'no healthy upstream' }";
    expect(sanitizeUiLogMessage(msg, 'error')).toBe('ERR_TECHNICAL_DETAILS_HIDDEN');
  });

  it('truncates long lines', () => {
    const msg = 'a'.repeat(20000);
    const out = sanitizeUiLogMessage(msg, 'info');
    expect(out.length).toBeLessThanOrEqual(10000);
    expect(out.endsWith('...')).toBe(true);
  });

  it('strips ANSI and control characters', () => {
    const msg = '\u001b[31mRED\u001b[0m\u0007\u0001';
    const out = sanitizeUiLogMessage(msg, 'info');
    expect(out).toBe('RED  ');
  });
});
