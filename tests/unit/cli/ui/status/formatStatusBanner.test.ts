import { describe, it, expect } from 'bun:test';
import { formatStatusBanner } from '../../../../../src/cli/ui/status/formatStatusBanner.js';

describe('formatStatusBanner', () => {
  it('should format banner with both face and label', () => {
    expect(formatStatusBanner({ face: '😀', label: 'Happy' })).toBe('😀 Happy');
  });

  it('should trim whitespace from face and label', () => {
    expect(formatStatusBanner({ face: '  😀  ', label: '  Happy  ' })).toBe('😀 Happy');
  });

  it('should return only face when label is undefined', () => {
    expect(formatStatusBanner({ face: '😀' })).toBe('😀');
  });

  it('should return only face when label is empty string', () => {
    expect(formatStatusBanner({ face: '😀', label: '' })).toBe('😀');
  });

  it('should return only face when label is whitespace only', () => {
    expect(formatStatusBanner({ face: '😀', label: '   ' })).toBe('😀');
  });
});
