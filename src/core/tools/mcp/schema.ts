import { z } from 'zod';

import { getLogger } from '../../observability/logger.js';

interface JsonSchema {
  type?: string;
  description?: string;
  properties?: Record<string, unknown>;
  required?: string[];
  items?: unknown;
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

  // Handle cases where the schema is just a description or empty
  if (!schema.type && !schema.properties) {
    return z.any();
  }

  try {
    switch (schema.type) {
      case 'string':
        return z.string().describe(schema.description || '');

      case 'number':
      case 'integer':
        return z.number().describe(schema.description || '');

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
        return z.object(shape).describe(schema.description || '');
      }

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
