import { describe, expect, it } from 'bun:test';

import {
  formatCanonicalFunctionCallItemId,
  parseCanonicalFunctionCallItemId,
} from '../../../../../src/core/streaming/canonical/function-call-item-id.js';

describe('canonical function call item_id helpers', () => {
  it('formats and parses call ids', () => {
    const itemId = formatCanonicalFunctionCallItemId('call-1');
    expect(itemId).toBe('function_call:call-1');
    expect(parseCanonicalFunctionCallItemId(itemId)).toBe('call-1');
  });

  it('returns null for non-matching ids', () => {
    expect(parseCanonicalFunctionCallItemId(undefined)).toBe(null);
    expect(parseCanonicalFunctionCallItemId('')).toBe(null);
    expect(parseCanonicalFunctionCallItemId('message:call-1')).toBe(null);
    expect(parseCanonicalFunctionCallItemId('function_call:')).toBe(null);
  });
});
