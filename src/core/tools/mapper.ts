import { zodToJsonSchema } from 'zod-to-json-schema';

import { ToolSpec } from './types';

/**
 * Maps a SalmonLoop ToolSpec to the OpenAI tool definition format.
 */
export function toolToOpenAI(spec: ToolSpec) {
  return {
    type: 'function',
    function: {
      name: spec.name,
      description: spec.description,
      parameters: zodToJsonSchema(spec.inputSchema as any, {
        target: 'openApi3',
        $refStrategy: 'none',
      }),
    },
  };
}

/**
 * Maps a SalmonLoop ToolSpec to the Anthropic tool definition format.
 */
export function toolToAnthropic(spec: ToolSpec) {
  const schema = zodToJsonSchema(spec.inputSchema as any, {
    target: 'openApi3',
    $refStrategy: 'none',
  });

  return {
    name: spec.name,
    description: spec.description,
    input_schema: schema,
  };
}

/**
 * Formats tool specifications for in-line prompt documentation.
 */
export function formatToolsForPrompt(specs: ToolSpec[]): string {
  return specs
    .map((spec) => {
      const schema = zodToJsonSchema(spec.inputSchema as any, {
        target: 'openApi3',
        $refStrategy: 'none',
      });
      return `Tool: ${spec.name}\nDescription: ${spec.description}\nSchema: ${JSON.stringify(schema, null, 2)}`;
    })
    .join('\n\n---\n\n');
}
