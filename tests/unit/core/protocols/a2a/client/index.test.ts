import { describe, expect, test } from 'bun:test';

import {
  createA2AClient,
  createA2AHttpTransport,
} from '../../../../../../src/core/protocols/a2a/client/index.js';

describe('A2A client barrel exports', () => {
  test('exports createA2AClient and createA2AHttpTransport', () => {
    expect(typeof createA2AClient).toBe('function');
    expect(typeof createA2AHttpTransport).toBe('function');
  });
});
