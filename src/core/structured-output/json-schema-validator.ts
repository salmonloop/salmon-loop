import { Ajv, type ValidateFunction } from 'ajv';

import type { StructuredOutputValidationResult } from './types.js';

type JsonSchema = Record<string, unknown>;

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    try {
      return String(value);
    } catch {
      return '[Unserializable]';
    }
  }
}

function toSchemaKey(schema: unknown): string {
  if (!schema || typeof schema !== 'object') return `non_object:${typeof schema}`;
  return safeStringify(schema);
}

export interface JsonSchemaValidatorOptions {
  cacheSize?: number;
}

export class JsonSchemaValidator {
  private readonly ajv: Ajv;
  private readonly cache: Map<string, ValidateFunction> = new Map();
  private readonly cacheSize: number;

  constructor(options: JsonSchemaValidatorOptions = {}) {
    this.cacheSize = options.cacheSize ?? 64;
    this.ajv = new Ajv({
      allErrors: true,
      strict: false,
      allowUnionTypes: true,
    });
  }

  validate(params: { schema: unknown; data: unknown }): StructuredOutputValidationResult {
    const schema = params.schema;
    if (!schema || typeof schema !== 'object') {
      return {
        ok: false,
        error: {
          code: 'SCHEMA_INVALID',
          message: 'JSON Schema must be an object.',
          details: { schemaType: typeof schema },
        },
      };
    }

    const key = toSchemaKey(schema);
    let validate: ValidateFunction | undefined = this.cache.get(key);
    if (!validate) {
      try {
        validate = this.ajv.compile(schema as JsonSchema);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          ok: false,
          error: {
            code: 'SCHEMA_INVALID',
            message: `Invalid JSON Schema: ${msg}`,
          },
        };
      }

      if (this.cache.size >= this.cacheSize) {
        const first = this.cache.keys().next().value;
        if (first) this.cache.delete(first);
      }
      if (validate) this.cache.set(key, validate);
    }

    if (!validate) {
      return {
        ok: false,
        error: {
          code: 'SCHEMA_INVALID',
          message: 'Failed to compile JSON Schema.',
        },
      };
    }

    const ok = Boolean(validate(params.data));
    if (ok) return { ok: true };

    return {
      ok: false,
      error: {
        code: 'SCHEMA_VALIDATION_FAILED',
        message: 'Structured output failed schema validation.',
        details: validate.errors ?? undefined,
      },
    };
  }
}
