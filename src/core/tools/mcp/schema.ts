import { z } from 'zod';

import { getLogger } from '../../observability/logger.js';

interface JsonSchema {
  type?: string | string[];
  description?: string;
  properties?: Record<string, unknown>;
  required?: string[];
  items?: unknown;
  enum?: unknown[];
  const?: unknown;
  oneOf?: unknown[];
  anyOf?: unknown[];
  allOf?: unknown[];
  additionalProperties?: boolean | unknown;
  [key: string]: unknown;
}

/**
 * Converts a JSON Schema (commonly used in MCP) to a Zod schema.
 * This implementation covers the core JSON Schema types used by tools.
 */
export function jsonSchemaToZod(jsonSchema: unknown): z.ZodType<any> {
  if (!jsonSchema || typeof jsonSchema !== 'object') {
    return z.any();
  }

  const schema = jsonSchema as JsonSchema;

  if (Array.isArray(schema.oneOf) && schema.oneOf.length > 0) {
    return unionToZod(schema.oneOf).describe(schema.description || '');
  }

  if (Array.isArray(schema.anyOf) && schema.anyOf.length > 0) {
    return unionToZod(schema.anyOf).describe(schema.description || '');
  }

  if (Array.isArray(schema.allOf) && schema.allOf.length > 0) {
    const parts = schema.allOf.map((part) => jsonSchemaToZod(part));
    return parts.reduce((acc, part) => acc.and(part)).describe(schema.description || '');
  }

  if (Object.prototype.hasOwnProperty.call(schema, 'const')) {
    return z.literal(schema.const as never).describe(schema.description || '');
  }

  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    const literals = schema.enum.map((value) => z.literal(value as never));
    return unionLiterals(literals).describe(schema.description || '');
  }

  if (Array.isArray(schema.type)) {
    const nullable = schema.type.includes('null');
    const nonNullTypes = schema.type.filter((type) => type !== 'null');
    const typed = unionToZod(nonNullTypes.map((type) => ({ ...schema, type })));
    return nullable ? typed.nullable().describe(schema.description || '') : typed;
  }

  // Handle cases where the schema is just a description or empty
  if (!schema.type && !schema.properties) {
    return z.any();
  }

  try {
    switch (schema.type) {
      case 'string':
        return z.string().describe(schema.description || '');

      case 'number':
        return z.number().describe(schema.description || '');

      case 'integer':
        return z
          .number()
          .int()
          .describe(schema.description || '');

      case 'boolean':
        return z.boolean().describe(schema.description || '');

      case 'array': {
        const items = schema.items ? jsonSchemaToZod(schema.items) : z.any();
        return z.array(items).describe(schema.description || '');
      }

      case 'object':
      case undefined: {
        // Often schemas with properties omit 'type: object'
        const shape: Record<string, z.ZodType<any>> = {};
        const properties = (schema.properties || {}) as Record<string, unknown>;
        const required = schema.required || [];

        for (const [key, prop] of Object.entries(properties)) {
          let fieldSchema = jsonSchemaToZod(prop);
          if (!required.includes(key)) {
            fieldSchema = fieldSchema.optional();
          }
          shape[key] = fieldSchema;
        }
        let objectSchema = z.object(shape);
        if (schema.additionalProperties === true) {
          objectSchema = objectSchema.catchall(z.unknown());
        } else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
          objectSchema = objectSchema.catchall(jsonSchemaToZod(schema.additionalProperties));
        }
        return objectSchema.describe(schema.description || '');
      }

      case 'null':
        return z.null().describe(schema.description || '');

      default:
        getLogger().debug(`Unsupported JSON schema type: ${schema.type}, falling back to any`);
        return z.any();
    }
  } catch (err) {
    getLogger().error(
      `Failed to convert JSON schema to Zod: ${String(err)} (Schema: ${JSON.stringify(schema)})`,
    );
    return z.any();
  }
}

function unionToZod(schemas: unknown[]): z.ZodType<any> {
  if (schemas.length === 0) return z.any();
  if (schemas.length === 1) return jsonSchemaToZod(schemas[0]);
  const [first, second, ...rest] = schemas.map((part) => jsonSchemaToZod(part));
  return z.union([first, second, ...rest]);
}

function unionLiterals(literals: z.ZodLiteral<any>[]): z.ZodType<any> {
  if (literals.length === 1) return literals[0];
  const [first, second, ...rest] = literals;
  return z.union([first, second, ...rest]);
}
