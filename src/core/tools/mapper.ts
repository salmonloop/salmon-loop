import { z } from 'zod';

import { unwrapZodSchema } from '../utils/zod.js';

import { ToolSpec } from './types.js';

type JsonSchema =
  | {
      type: 'object';
      properties: Record<string, JsonSchema>;
      required?: string[];
      description?: string;
    }
  | { type: 'array'; items: JsonSchema; description?: string }
  | { type: 'string'; enum?: string[]; description?: string }
  | { type: 'number'; description?: string }
  | { type: 'integer'; description?: string }
  | { type: 'boolean'; description?: string }
  | { oneOf: JsonSchema[]; description?: string }
  | { const: unknown; description?: string }
  | { description?: string };

function formatToolExamplesForDescription(spec: ToolSpec): string {
  if (!Array.isArray(spec.examples) || spec.examples.length === 0) return '';

  const examples = spec.examples
    .map((example) => {
      const input = JSON.stringify(example.input);
      return input ? `- ${example.description}: ${input}` : undefined;
    })
    .filter((line): line is string => Boolean(line));

  return examples.length > 0 ? `\n\nExamples:\n${examples.join('\n')}` : '';
}

function toolDescriptionForModel(spec: ToolSpec): string {
  return `${spec.description}${formatToolExamplesForDescription(spec)}`;
}

const unwrapForSchemaGeneration = unwrapZodSchema;

function zodToOpenApi3(schema: z.ZodTypeAny): JsonSchema {
  const unwrapped = unwrapForSchemaGeneration(schema);
  const description = unwrapped.description;

  if (unwrapped instanceof z.ZodObject) {
    const shape = unwrapped.shape as Record<string, z.ZodTypeAny>;
    const properties: Record<string, JsonSchema> = {};
    const required: string[] = [];

    for (const [key, value] of Object.entries(shape)) {
      properties[key] = zodToOpenApi3(value);
      if (!value.isOptional()) required.push(key);
    }

    const out: JsonSchema = {
      type: 'object',
      properties,
      ...(required.length > 0 ? { required } : {}),
    };
    if (description) out.description = description;
    return out;
  }

  if (unwrapped instanceof z.ZodArray) {
    const items = zodToOpenApi3(unwrapped.element as z.ZodTypeAny);
    const out: JsonSchema = { type: 'array', items };
    if (description) out.description = description;
    return out;
  }

  if (unwrapped instanceof z.ZodEnum) {
    const options = unwrapped.options;
    const values: string[] = options.map(String);

    const out: JsonSchema =
      values.length > 0 ? { type: 'string', enum: values } : { type: 'string' };
    if (description) out.description = description;
    return out;
  }

  if (unwrapped instanceof z.ZodLiteral) {
    const out: JsonSchema = { const: unwrapped.value };
    if (description) out.description = description;
    return out;
  }

  if (unwrapped instanceof z.ZodUnion) {
    const options = unwrapped.options as unknown as z.ZodTypeAny[];
    const out: JsonSchema = { oneOf: options.map((o) => zodToOpenApi3(o)) };
    if (description) out.description = description;
    return out;
  }

  if (unwrapped instanceof z.ZodString) {
    const out: JsonSchema = { type: 'string' };
    if (description) out.description = description;
    return out;
  }

  if (unwrapped instanceof z.ZodBoolean) {
    const out: JsonSchema = { type: 'boolean' };
    if (description) out.description = description;
    return out;
  }

  if (unwrapped instanceof z.ZodNumber) {
    const isInt = unwrapped.isInt;
    const out: JsonSchema = { type: isInt ? 'integer' : 'number' };
    if (description) out.description = description;
    return out;
  }

  // Fallback: keep schema permissive but include any description as a hint.
  return description ? { description } : {};
}

/**
 * Maps a SalmonLoop ToolSpec to the OpenAI tool definition format.
 */
export function toolToOpenAI(spec: ToolSpec) {
  return {
    type: 'function',
    function: {
      name: spec.name,
      description: toolDescriptionForModel(spec),
      parameters: zodToOpenApi3(spec.inputSchema),
    },
  };
}

/**
 * Maps a SalmonLoop ToolSpec to the Anthropic tool definition format.
 */
export function toolToAnthropic(spec: ToolSpec) {
  return {
    name: spec.name,
    description: toolDescriptionForModel(spec),
    input_schema: zodToOpenApi3(spec.inputSchema),
  };
}

/**
 * Formats tool specifications for in-line prompt documentation.
 */
export function formatToolsForPrompt(specs: ToolSpec[]): string {
  return specs
    .map((spec) => {
      const schema = zodToOpenApi3(spec.inputSchema);
      return `Tool: ${spec.name}\nDescription: ${toolDescriptionForModel(spec)}\nSchema: ${JSON.stringify(schema, null, 2)}`;
    })
    .join('\n\n---\n\n');
}
