import { describe, expect, it } from 'bun:test';

import { jsonSchemaToZod } from '../../../../../src/core/tools/mcp/schema.js';

describe('jsonSchemaToZod', () => {
  it('supports enum, const, integer, and nullable type arrays', () => {
    const schema = jsonSchemaToZod({
      type: 'object',
      properties: {
        mode: { enum: ['read', 'write'] },
        version: { const: 1 },
        count: { type: 'integer' },
        note: { type: ['string', 'null'] },
      },
      required: ['mode', 'version', 'count', 'note'],
    });

    expect(schema.parse({ mode: 'read', version: 1, count: 2, note: null })).toEqual({
      mode: 'read',
      version: 1,
      count: 2,
      note: null,
    });
    expect(() => schema.parse({ mode: 'delete', version: 1, count: 2, note: null })).toThrow();
    expect(() => schema.parse({ mode: 'read', version: 2, count: 2, note: null })).toThrow();
    expect(() => schema.parse({ mode: 'read', version: 1, count: 2.5, note: null })).toThrow();
  });

  it('supports unions and typed additionalProperties', () => {
    const schema = jsonSchemaToZod({
      type: 'object',
      properties: {
        target: {
          anyOf: [{ type: 'string' }, { type: 'number' }],
        },
      },
      required: ['target'],
      additionalProperties: { type: 'boolean' },
    });

    expect(schema.parse({ target: 'file', dryRun: true })).toEqual({
      target: 'file',
      dryRun: true,
    });
    expect(schema.parse({ target: 42, dryRun: false })).toEqual({
      target: 42,
      dryRun: false,
    });
    expect(() => schema.parse({ target: true })).toThrow();
    expect(() => schema.parse({ target: 'file', dryRun: 'yes' })).toThrow();
  });
});
