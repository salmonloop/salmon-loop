import { z } from 'zod';

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

function unwrapForSchemaGeneration(schema: z.ZodTypeAny): z.ZodTypeAny {
  let current: z.ZodTypeAny = schema;
  for (let depth = 0; depth < 20; depth++) {
    const ZodEffects: any = (z as any).ZodEffects;
    if (typeof ZodEffects === 'function' && current instanceof ZodEffects) {
      current = (current as any)._def.schema;
      continue;
    }
    if (current instanceof z.ZodPipe) {
      // z.preprocess in Zod v4 produces a ZodPipe(in=ZodTransform, out=<schema>).
      current = (current as any)._def.out;
      continue;
    }
    if (current instanceof z.ZodOptional) {
      current = (current as any)._def.innerType;
      continue;
    }
    if (current instanceof z.ZodNullable) {
      current = (current as any)._def.innerType;
      continue;
    }
    if (current instanceof z.ZodDefault) {
      current = (current as any)._def.innerType;
      continue;
    }
    break;
  }
  return current;
}

function zodToOpenApi3(schema: z.ZodTypeAny): JsonSchema {
  const unwrapped = unwrapForSchemaGeneration(schema);
  const description = (unwrapped as any).description as string | undefined;

  if (unwrapped instanceof z.ZodObject) {
    const shape = (unwrapped as any).shape as Record<string, z.ZodTypeAny>;
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
    const items = zodToOpenApi3((unwrapped as any)._def.type);
    const out: JsonSchema = { type: 'array', items };
    if (description) out.description = description;
    return out;
  }

  if (unwrapped instanceof z.ZodEnum) {
    const options = (unwrapped as any).options ?? (unwrapped as any)._def?.values;
    let values: string[] = [];
    if (Array.isArray(options)) {
      values = options.map(String);
    } else if (options && typeof options === 'object') {
      values = Object.values(options).map(String);
    }

    const out: JsonSchema =
      values.length > 0 ? { type: 'string', enum: values } : { type: 'string' };
    if (description) out.description = description;
    return out;
  }

  if (unwrapped instanceof z.ZodLiteral) {
    const out: JsonSchema = { const: (unwrapped as any)._def.value };
    if (description) out.description = description;
    return out;
  }

  if (unwrapped instanceof z.ZodUnion) {
    const options = (unwrapped as any)._def.options as z.ZodTypeAny[];
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
    const isInt = Boolean((unwrapped as any)._def.checks?.some((c: any) => c.kind === 'int'));
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
      description: spec.description,
      parameters: zodToOpenApi3(spec.inputSchema as any),
    },
  };
}

/**
 * Maps a SalmonLoop ToolSpec to the Anthropic tool definition format.
 */
export function toolToAnthropic(spec: ToolSpec) {
  return {
    name: spec.name,
    description: spec.description,
    input_schema: zodToOpenApi3(spec.inputSchema as any),
  };
}

/**
 * Formats tool specifications for in-line prompt documentation.
 */
export function formatToolsForPrompt(specs: ToolSpec[]): string {
  return specs
    .map((spec) => {
      const schema = zodToOpenApi3(spec.inputSchema as any);
      return `Tool: ${spec.name}\nDescription: ${spec.description}\nSchema: ${JSON.stringify(schema, null, 2)}`;
    })
    .join('\n\n---\n\n');
}
