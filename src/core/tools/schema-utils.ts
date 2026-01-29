import { z } from 'zod';

export interface PromptParam {
  name: string;
  type: string;
  required: boolean;
  description?: string;
  enum?: string[];
}

/**
 * Extracts a simplified schema representation for LLM prompts from a Zod schema.
 * This avoids the overhead of a full JSON Schema generator and provides
 * exactly what the LLM needs to know to call the tool.
 */
export function extractPromptParams(schema: z.ZodTypeAny): PromptParam[] {
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape;
    return Object.entries(shape).map(([key, value]) => {
      const typeDef = value as z.ZodTypeAny;

      // Determine type
      let typeName = 'string';
      if (typeDef instanceof z.ZodString) typeName = 'string';
      else if (typeDef instanceof z.ZodNumber) typeName = 'number';
      else if (typeDef instanceof z.ZodBoolean) typeName = 'boolean';
      else if (typeDef instanceof z.ZodArray) typeName = 'array';
      else if (typeDef instanceof z.ZodObject) typeName = 'object';
      else if (typeDef instanceof z.ZodEnum) typeName = 'string';

      // Check optionality
      const isOptional = typeDef.isOptional();

      // Extract description
      const description = typeDef.description;

      // Extract enum values if applicable
      let enumValues: string[] | undefined;
      if (typeDef instanceof z.ZodEnum) {
        enumValues = typeDef.options.map(String);
      }

      return {
        name: key,
        type: typeName,
        required: !isOptional,
        description,
        enum: enumValues,
      };
    });
  }

  return [];
}

/**
 * Formats a tool definition into a standard block for the system prompt.
 */
export function formatToolDefinition(
  name: string,
  description: string,
  schema: z.ZodTypeAny,
): string {
  const params = extractPromptParams(schema);

  let paramBlock = '';
  if (params.length > 0) {
    paramBlock =
      '   Input schema:\n' +
      params
        .map((p) => {
          const reqStr = p.required ? 'required' : 'optional';
          const enumStr = p.enum ? ` (one of: ${p.enum.join(', ')})` : '';
          const descStr = p.description ? `: ${p.description}` : '';
          return `     - ${p.name} (${p.type}, ${reqStr})${enumStr}${descStr}`;
        })
        .join('\n');
  } else {
    paramBlock = '   Input schema: (no parameters)';
  }

  return `1. Tool: ${name}
   Description: ${description}
${paramBlock}`;
}
