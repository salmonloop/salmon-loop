import { describe, expect, it } from 'vitest';

import { JsonSchemaValidator } from '../../../../src/core/structured-output/index.js';

describe('JsonSchemaValidator', () => {
  it('returns SCHEMA_INVALID for non-object schemas', () => {
    const v = new JsonSchemaValidator();
    const res = v.validate({ schema: 'nope', data: {} });
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe('SCHEMA_INVALID');
  });

  it('validates data against a simple schema', () => {
    const v = new JsonSchemaValidator();
    const schema = {
      type: 'object',
      properties: {
        a: { type: 'string' },
      },
      required: ['a'],
      additionalProperties: true,
    };

    expect(v.validate({ schema, data: { a: 'x' } }).ok).toBe(true);

    const bad = v.validate({ schema, data: { a: 1 } });
    expect(bad.ok).toBe(false);
    expect(bad.error?.code).toBe('SCHEMA_VALIDATION_FAILED');
  });
});
