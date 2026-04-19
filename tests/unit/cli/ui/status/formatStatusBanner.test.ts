import { describe, expect, test } from 'bun:test';
import { formatStatusBanner } from '../../../../../src/cli/ui/status/formatStatusBanner.js';

describe('formatStatusBanner', () => {
  test('returns just the face when label is not provided', () => {
    expect(formatStatusBanner({ face: 'O_o' })).toBe('O_o');
  });

  test('returns face and label separated by a space', () => {
    expect(formatStatusBanner({ face: 'O_o', label: 'Thinking' })).toBe('O_o Thinking');
  });

  test('trims whitespace from face and label', () => {
    expect(formatStatusBanner({ face: '  O_o  ', label: '  Thinking  ' })).toBe('O_o Thinking');
  });

  test('returns just the trimmed face when label is an empty string', () => {
    expect(formatStatusBanner({ face: 'O_o', label: '' })).toBe('O_o');
  });

  test('returns just the trimmed face when label is only whitespace', () => {
    expect(formatStatusBanner({ face: 'O_o', label: '   ' })).toBe('O_o');
  });

  test('returns just the trimmed face when label is not provided and face has whitespace', () => {
    expect(formatStatusBanner({ face: '  O_o  ' })).toBe('O_o');
  });
});
