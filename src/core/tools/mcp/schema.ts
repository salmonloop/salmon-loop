import { z } from 'zod';

import { logger } from '../../logger.js';

/**
 * Converts a JSON Schema (commonly used in MCP) to a Zod schema.
 * This implementation covers the core JSON Schema types used by tools.
 */
export function jsonSchemaToZod(jsonSchema: any): z.ZodType<any> {
  if (!jsonSchema || typeof jsonSchema !== 'object') {
    return z.any();
  }

  // Handle cases where the schema is just a description or empty
  if (!jsonSchema.type && !jsonSchema.properties) {
    return z.any();
  }

  try {
    switch (jsonSchema.type) {
      case 'string':
        return z.string().describe(jsonSchema.description || '');

      case 'number':
      case 'integer':
        return z.number().describe(jsonSchema.description || '');

      case 'boolean':
        return z.boolean().describe(jsonSchema.description || '');

      case 'array': {
        const items = jsonSchema.items ? jsonSchemaToZod(jsonSchema.items) : z.any();
        return z.array(items).describe(jsonSchema.description || '');
      }

      case 'object':
      case undefined: {
        // Often schemas with properties omit 'type: object'
        const shape: Record<string, z.ZodType<any>> = {};
        const properties = jsonSchema.properties || {};
        const required = jsonSchema.required || [];

        for (const [key, prop] of Object.entries(properties)) {
          let fieldSchema = jsonSchemaToZod(prop);
          if (!required.includes(key)) {
            fieldSchema = fieldSchema.optional();
          }
          shape[key] = fieldSchema;
        }
        return z.object(shape).describe(jsonSchema.description || '');
      }

      default:
        logger.debug(`Unsupported JSON schema type: ${jsonSchema.type}, falling back to any`);
        return z.any();
    }
  } catch (err) {
    logger.error(
      `Failed to convert JSON schema to Zod: ${err} (Schema: ${JSON.stringify(jsonSchema)})`,
    );
    return z.any();
  }
}
