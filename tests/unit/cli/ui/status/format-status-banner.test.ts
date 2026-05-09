import { describe, expect, it } from 'bun:test';

import { formatStatusBanner } from '../../../../../src/cli/ui/status/formatStatusBanner.js';

describe('formatStatusBanner', () => {
  it('returns face and label separated by single space when label is provided', () => {
    const result = formatStatusBanner({ face: '😀', label: 'Running' });
    expect(result).toBe('😀 Running');
  });

  it('trims whitespace from face and label', () => {
    const result = formatStatusBanner({ face: '  😀  ', label: '  Running  ' });
    expect(result).toBe('😀 Running');
  });

  it('returns only face when label is undefined', () => {
    const result = formatStatusBanner({ face: '🤔' });
    expect(result).toBe('🤔');
  });

  it('returns only face when label is an empty string', () => {
    const result = formatStatusBanner({ face: '😴', label: '' });
    expect(result).toBe('😴');
  });

  it('returns only face when label contains only whitespace', () => {
    const result = formatStatusBanner({ face: '😴', label: '   ' });
    expect(result).toBe('😴');
  });
});
