import { describe, expect, it } from 'bun:test';

import { jsonSchemaToZod } from '../../../../src/core/mcp/schema/json-schema-to-zod.js';

describe('jsonSchemaToZod', () => {
  it('supports boolean schemas', () => {
    const acceptAnything = jsonSchemaToZod(true);
    const rejectEverything = jsonSchemaToZod(false);

    expect(acceptAnything.parse({ any: 'value' })).toEqual({ any: 'value' });
    expect(acceptAnything.parse(null)).toBeNull();
    expect(() => rejectEverything.parse({ any: 'value' })).toThrow();
    expect(() => rejectEverything.parse(null)).toThrow();
  });

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

  it('treats a null-only type array as null-only', () => {
    const schema = jsonSchemaToZod({
      type: ['null'],
    });

    expect(schema.parse(null)).toBeNull();
    expect(() => schema.parse('not-null')).toThrow();
  });

  it('applies sibling keywords alongside const and enum', () => {
    const constSchema = jsonSchemaToZod({
      const: 'ready!',
      type: 'string',
      minLength: 6,
    });
    const enumSchema = jsonSchemaToZod({
      enum: ['read', 'write'],
      type: 'string',
      pattern: '^wr',
    });

    expect(constSchema.parse('ready!')).toBe('ready!');
    expect(() => constSchema.parse('short')).toThrow();
    expect(() => constSchema.parse(1)).toThrow();

    expect(enumSchema.parse('write')).toBe('write');
    expect(() => enumSchema.parse('read')).toThrow();
    expect(() => enumSchema.parse(1)).toThrow();
  });

  it('supports common string, number, and array validation keywords', () => {
    const schema = jsonSchemaToZod({
      type: 'object',
      properties: {
        name: {
          type: 'string',
          minLength: 2,
          maxLength: 5,
          pattern: '^[a-z]+$',
        },
        count: {
          type: 'number',
          minimum: 1,
          exclusiveMaximum: 10,
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          minItems: 1,
          maxItems: 2,
        },
      },
      required: ['name', 'count', 'tags'],
    });

    expect(schema.parse({ name: 'repo', count: 3, tags: ['mcp'] })).toEqual({
      name: 'repo',
      count: 3,
      tags: ['mcp'],
    });
    expect(() => schema.parse({ name: 'R', count: 3, tags: ['mcp'] })).toThrow();
    expect(() => schema.parse({ name: 'tooling', count: 3, tags: ['mcp'] })).toThrow();
    expect(() => schema.parse({ name: 'repo1', count: 3, tags: ['mcp'] })).toThrow();
    expect(() => schema.parse({ name: 'repo', count: 0, tags: ['mcp'] })).toThrow();
    expect(() => schema.parse({ name: 'repo', count: 10, tags: ['mcp'] })).toThrow();
    expect(() => schema.parse({ name: 'repo', count: 3, tags: [] })).toThrow();
    expect(() => schema.parse({ name: 'repo', count: 3, tags: ['mcp', 'a2a', 'acp'] })).toThrow();
  });

  it('supports contains with minContains and maxContains', () => {
    const boundedMatches = jsonSchemaToZod({
      type: 'array',
      contains: {
        type: 'integer',
        minimum: 5,
      },
      minContains: 2,
      maxContains: 3,
    });
    const defaultContains = jsonSchemaToZod({
      type: 'array',
      contains: {
        type: 'string',
        minLength: 4,
      },
    });

    expect(boundedMatches.parse([5, 'skip', 7])).toEqual([5, 'skip', 7]);
    expect(boundedMatches.parse([5, 6, 7])).toEqual([5, 6, 7]);
    expect(() => boundedMatches.parse([5, 'skip'])).toThrow();
    expect(() => boundedMatches.parse([5, 6, 7, 8])).toThrow();

    expect(defaultContains.parse(['tool', 1])).toEqual(['tool', 1]);
    expect(() => defaultContains.parse(['no', 1])).toThrow();
  });

  it('supports prefixItems with trailing items constraints', () => {
    const tupleWithClosedTail = jsonSchemaToZod({
      type: 'array',
      prefixItems: [{ type: 'string' }, { type: 'integer' }],
      items: false,
    });
    const tupleWithTypedTail = jsonSchemaToZod({
      type: 'array',
      prefixItems: [{ type: 'string' }, { type: 'integer' }],
      items: { type: 'boolean' },
    });

    expect(tupleWithClosedTail.parse(['repo', 2])).toEqual(['repo', 2]);
    expect(() => tupleWithClosedTail.parse(['repo', '2'])).toThrow();
    expect(() => tupleWithClosedTail.parse(['repo', 2, true])).toThrow();

    expect(tupleWithTypedTail.parse(['repo', 2, true, false])).toEqual(['repo', 2, true, false]);
    expect(() => tupleWithTypedTail.parse(['repo', 2, 'extra'])).toThrow();
  });

  it('applies object and array keywords even when type is omitted', () => {
    const objectSchema = jsonSchemaToZod({
      required: ['name'],
      properties: {
        name: { type: 'string' },
      },
    });
    const arraySchema = jsonSchemaToZod({
      minItems: 1,
      items: { type: 'integer' },
    });

    expect(objectSchema.parse({ name: 'salmon' })).toEqual({ name: 'salmon' });
    expect(() => objectSchema.parse({})).toThrow();
    expect(objectSchema.parse('not-an-object')).toBe('not-an-object');

    expect(arraySchema.parse([1])).toEqual([1]);
    expect(() => arraySchema.parse([])).toThrow();
    expect(arraySchema.parse('not-an-array')).toBe('not-an-array');
  });

  it('enforces required properties even when no property schema is declared', () => {
    const schema = jsonSchemaToZod({
      type: 'object',
      required: ['name'],
    });

    expect(schema.parse({ name: 'salmon' })).toEqual({ name: 'salmon' });
    expect(() => schema.parse({})).toThrow();
  });

  it('supports not and if/then/else conditionals', () => {
    const notSchema = jsonSchemaToZod({
      not: {
        type: 'integer',
      },
    });
    const conditionalSchema = jsonSchemaToZod({
      type: 'object',
      properties: {
        country: {
          enum: ['United States of America', 'Canada'],
        },
        postal_code: {
          type: 'string',
        },
      },
      if: {
        properties: {
          country: {
            const: 'United States of America',
          },
        },
        required: ['country'],
      },
      then: {
        properties: {
          postal_code: {
            type: 'string',
            pattern: '^[0-9]{5}(-[0-9]{4})?$',
          },
        },
        required: ['postal_code'],
      },
      else: {
        properties: {
          postal_code: {
            type: 'string',
            pattern: '^[A-Z][0-9][A-Z] [0-9][A-Z][0-9]$',
          },
        },
        required: ['postal_code'],
      },
    });

    expect(notSchema.parse('text')).toBe('text');
    expect(() => notSchema.parse(1)).toThrow();

    expect(
      conditionalSchema.parse({
        country: 'United States of America',
        postal_code: '20500',
      }),
    ).toEqual({
      country: 'United States of America',
      postal_code: '20500',
    });
    expect(
      conditionalSchema.parse({
        country: 'Canada',
        postal_code: 'K1A 0B1',
      }),
    ).toEqual({
      country: 'Canada',
      postal_code: 'K1A 0B1',
    });
    expect(() =>
      conditionalSchema.parse({
        country: 'United States of America',
        postal_code: 'K1A 0B1',
      }),
    ).toThrow();
    expect(() =>
      conditionalSchema.parse({
        country: 'Canada',
        postal_code: '20500',
      }),
    ).toThrow();
  });

  it('supports dependentRequired and dependentSchemas', () => {
    const schema = jsonSchemaToZod({
      type: 'object',
      properties: {
        name: { type: 'string' },
        credit_card: { type: 'number' },
        billing_address: { type: 'string' },
        country: { enum: ['United States of America', 'Canada'] },
        postal_code: { type: 'string' },
      },
      dependentRequired: {
        credit_card: ['billing_address'],
      },
      dependentSchemas: {
        country: {
          type: 'object',
          if: {
            properties: {
              country: { const: 'United States of America' },
            },
            required: ['country'],
          },
          then: {
            properties: {
              postal_code: {
                type: 'string',
                pattern: '^[0-9]{5}(-[0-9]{4})?$',
              },
            },
            required: ['postal_code'],
          },
          else: {
            properties: {
              postal_code: {
                type: 'string',
                pattern: '^[A-Z][0-9][A-Z] [0-9][A-Z][0-9]$',
              },
            },
            required: ['postal_code'],
          },
        },
      },
    });

    expect(
      schema.parse({
        name: 'John Doe',
        credit_card: 5555444433331111,
        billing_address: '555 Debtor Lane',
        country: 'United States of America',
        postal_code: '20500',
      }),
    ).toEqual({
      name: 'John Doe',
      credit_card: 5555444433331111,
      billing_address: '555 Debtor Lane',
      country: 'United States of America',
      postal_code: '20500',
    });
    expect(() =>
      schema.parse({
        name: 'John Doe',
        credit_card: 5555444433331111,
      }),
    ).toThrow();
    expect(() =>
      schema.parse({
        country: 'Canada',
        postal_code: '20500',
      }),
    ).toThrow();
  });

  it('supports multipleOf, uniqueItems, and object property count keywords', () => {
    const schema = jsonSchemaToZod({
      type: 'object',
      minProperties: 2,
      maxProperties: 3,
      properties: {
        count: {
          type: 'number',
          multipleOf: 0.5,
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          uniqueItems: true,
        },
        mode: {
          type: 'string',
        },
      },
      required: ['count', 'tags'],
    });

    expect(schema.parse({ count: 1.5, tags: ['mcp', 'a2a'] })).toEqual({
      count: 1.5,
      tags: ['mcp', 'a2a'],
    });
    expect(schema.parse({ count: 2, tags: ['mcp'], mode: 'strict' })).toEqual({
      count: 2,
      tags: ['mcp'],
      mode: 'strict',
    });
    expect(() => schema.parse({ count: 1.25, tags: ['mcp'] })).toThrow();
    expect(() => schema.parse({ count: 1.5, tags: ['mcp', 'mcp'] })).toThrow();
    expect(() => schema.parse({ count: 1.5 })).toThrow();
    expect(() =>
      schema.parse({
        count: 1.5,
        tags: ['mcp'],
        mode: 'strict',
        extra: true,
      }),
    ).toThrow();
  });

  it('supports propertyNames and patternProperties', () => {
    const schema = jsonSchemaToZod({
      type: 'object',
      propertyNames: {
        pattern: '^[a-z_]+$',
      },
      patternProperties: {
        '^meta_': { type: 'string' },
        '^count_': { type: 'integer' },
      },
    });

    expect(
      schema.parse({
        meta_name: 'salmon',
        count_runs: 2,
        other_key: true,
      }),
    ).toEqual({
      meta_name: 'salmon',
      count_runs: 2,
      other_key: true,
    });
    expect(() =>
      schema.parse({
        'meta-name': 'salmon',
      }),
    ).toThrow();
    expect(() =>
      schema.parse({
        meta_name: 1,
      }),
    ).toThrow();
    expect(() =>
      schema.parse({
        count_runs: '2',
      }),
    ).toThrow();
  });

  it('applies additionalProperties only to properties unmatched by patternProperties', () => {
    const schema = jsonSchemaToZod({
      type: 'object',
      properties: {
        builtin: { type: 'number' },
      },
      patternProperties: {
        '^meta_': { type: 'string' },
      },
      additionalProperties: { type: 'boolean' },
    });

    expect(
      schema.parse({
        builtin: 1,
        meta_name: 'salmon',
        dryRun: true,
      }),
    ).toEqual({
      builtin: 1,
      meta_name: 'salmon',
      dryRun: true,
    });
    expect(() =>
      schema.parse({
        builtin: 1,
        meta_name: 'salmon',
        dryRun: 'yes',
      }),
    ).toThrow();
    expect(() =>
      schema.parse({
        builtin: 1,
        meta_name: 1,
        dryRun: true,
      }),
    ).toThrow();
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

  it('preserves unspecified additionalProperties by default', () => {
    const schema = jsonSchemaToZod({
      type: 'object',
      properties: {
        target: { type: 'string' },
      },
      required: ['target'],
    });

    expect(
      schema.parse({
        target: 'file',
        dryRun: true,
        retries: 2,
      }),
    ).toEqual({
      target: 'file',
      dryRun: true,
      retries: 2,
    });
  });

  it('requires exactly one oneOf branch to match', () => {
    const schema = jsonSchemaToZod({
      oneOf: [
        {
          type: 'object',
          properties: {
            value: { type: 'string' },
          },
          required: ['value'],
        },
        {
          type: 'object',
          properties: {
            value: { enum: ['fixed'] },
          },
          required: ['value'],
        },
      ],
    });

    expect(schema.parse({ value: 'custom' })).toEqual({ value: 'custom' });
    expect(() => schema.parse({ value: 'fixed' })).toThrow();
    expect(() => schema.parse({ value: 1 })).toThrow();
  });

  it('applies sibling keywords alongside oneOf and anyOf', () => {
    const oneOfSchema = jsonSchemaToZod({
      type: 'object',
      properties: {
        shared: { type: 'string' },
      },
      required: ['shared'],
      oneOf: [
        {
          properties: {
            mode: { const: 'read' },
          },
          required: ['mode'],
        },
        {
          properties: {
            mode: { const: 'write' },
          },
          required: ['mode'],
        },
      ],
    });
    const anyOfSchema = jsonSchemaToZod({
      type: 'object',
      properties: {
        shared: { type: 'string' },
      },
      required: ['shared'],
      anyOf: [
        {
          properties: {
            dryRun: { type: 'boolean' },
          },
          required: ['dryRun'],
        },
        {
          properties: {
            retries: { type: 'integer' },
          },
          required: ['retries'],
        },
      ],
    });

    expect(oneOfSchema.parse({ shared: 'repo', mode: 'read' })).toEqual({
      shared: 'repo',
      mode: 'read',
    });
    expect(() => oneOfSchema.parse({ mode: 'read' })).toThrow();
    expect(anyOfSchema.parse({ shared: 'repo', dryRun: true })).toEqual({
      shared: 'repo',
      dryRun: true,
    });
    expect(() => anyOfSchema.parse({ dryRun: true })).toThrow();
  });

  it('applies sibling keywords alongside local $ref', () => {
    const schema = jsonSchemaToZod({
      $ref: '#/$defs/Name',
      minLength: 3,
      $defs: {
        Name: {
          type: 'string',
        },
      },
    });

    expect(schema.parse('repo')).toBe('repo');
    expect(() => schema.parse('ab')).toThrow();
    expect(() => schema.parse(1)).toThrow();
  });

  it('rejects unresolved external $ref instead of treating it as unconstrained', () => {
    const schema = jsonSchemaToZod({
      $ref: 'https://example.com/schemas/address',
    });

    expect(() => schema.parse({ any: 'value' })).toThrow();
    expect(() => schema.parse('anything')).toThrow();
  });

  it('resolves root self references recursively', () => {
    const schema = jsonSchemaToZod({
      type: 'object',
      properties: {
        name: { type: 'string' },
        children: {
          type: 'array',
          items: { $ref: '#' },
        },
      },
      required: ['name'],
    });

    expect(
      schema.parse({
        name: 'root',
        children: [{ name: 'child', children: [{ name: 'leaf' }] }],
      }),
    ).toEqual({
      name: 'root',
      children: [{ name: 'child', children: [{ name: 'leaf' }] }],
    });
    expect(() =>
      schema.parse({
        name: 'root',
        children: [{ name: 1 }],
      }),
    ).toThrow();
  });

  it('resolves local $anchor references', () => {
    const schema = jsonSchemaToZod({
      type: 'object',
      properties: {
        shipping: { $ref: '#address' },
      },
      required: ['shipping'],
      $defs: {
        Address: {
          $anchor: 'address',
          type: 'object',
          properties: {
            street: { type: 'string' },
            postalCode: { type: 'string' },
          },
          required: ['street'],
          additionalProperties: false,
        },
      },
    });

    expect(
      schema.parse({
        shipping: { street: '1600 Pennsylvania Ave' },
      }),
    ).toEqual({
      shipping: { street: '1600 Pennsylvania Ave' },
    });
    expect(() =>
      schema.parse({
        shipping: { street: 1600 },
      }),
    ).toThrow();
    expect(() =>
      schema.parse({
        shipping: { street: '1600 Pennsylvania Ave', extra: true },
      }),
    ).toThrow();
  });

  it('resolves local $defs references', () => {
    const schema = jsonSchemaToZod({
      type: 'object',
      properties: {
        payload: { $ref: '#/$defs/Payload' },
        items: {
          type: 'array',
          items: { $ref: '#/$defs/Payload' },
        },
      },
      required: ['payload', 'items'],
      $defs: {
        Payload: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            count: { type: 'integer' },
          },
          required: ['title', 'count'],
          additionalProperties: false,
        },
      },
    });

    expect(
      schema.parse({
        payload: { title: 'ready', count: 1 },
        items: [{ title: 'next', count: 2 }],
      }),
    ).toEqual({
      payload: { title: 'ready', count: 1 },
      items: [{ title: 'next', count: 2 }],
    });
    expect(() =>
      schema.parse({
        payload: { title: 'ready', count: '1' },
        items: [{ title: 'next', count: 2 }],
      }),
    ).toThrow();
    expect(() =>
      schema.parse({
        payload: { title: 'ready', count: 1, extra: true },
        items: [{ title: 'next', count: 2 }],
      }),
    ).toThrow();
  });
});
