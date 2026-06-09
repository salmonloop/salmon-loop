import { jsonSchema, tool } from 'ai';
import type { ModelMessage, ToolSet } from 'ai';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

import { toolToOpenAI } from '../../tools/mapper.js';
import type { ToolSpec } from '../../tools/types.js';
import type { LLMMessage } from '../../types/llm.js';
import { isRecord } from '../../utils/serialize.js';

function formatOutputSchema(schema: z.ZodType | undefined): string {
  if (!schema) return 'any (dynamic)';

  const def = schema.def as unknown as Record<string, unknown>;
  if (typeof def?.description === 'string') {
    return def.description;
  }

  try {
    const jsonSchemaObj = zodToJsonSchema(
      schema as unknown as Parameters<typeof zodToJsonSchema>[0],
      {
        target: 'openApi3',
        $refStrategy: 'none',
      },
    );

    if (jsonSchemaObj && typeof jsonSchemaObj === 'object') {
      const { $schema: _$schema, ...cleanSchema } = jsonSchemaObj as Record<string, unknown>;
      return JSON.stringify(cleanSchema);
    }
  } catch {
    // Fallback to generic description for invalid/unsupported schema.
  }

  return 'complex object';
}

function safeParseJsonObject(textValue: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(textValue);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  } catch {
    // ignored
  }
  return {};
}

function deepCloneJson(value: unknown, fallback: unknown): unknown {
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) return fallback;
    return JSON.parse(serialized);
  } catch {
    return fallback;
  }
}

const isObjectRecord = isRecord;

interface OpenAIToolDefinition {
  type?: string;
  function?: {
    name?: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

interface ToolCallInput {
  toolCallId?: string;
  id?: string;
  toolName?: string;
  name?: string;
  input?: unknown;
  args?: unknown;
  providerMetadata?: Record<string, unknown>;
}

export function extractUsageFromAiSdkResult(
  result: unknown,
): { promptTokens: number; completionTokens: number } | null {
  if (!isObjectRecord(result)) return null;

  const usage = result.usage;
  if (!isObjectRecord(usage)) return null;

  const promptTokens = usage.promptTokens ?? usage.prompt_tokens;
  const completionTokens = usage.completionTokens ?? usage.completion_tokens;

  if (typeof promptTokens !== 'number' || typeof completionTokens !== 'number') return null;
  if (!Number.isFinite(promptTokens) || !Number.isFinite(completionTokens)) return null;

  return { promptTokens, completionTokens };
}

function isToolApprovalResponse(value: unknown): value is {
  approvalId: string;
  approved: boolean;
  reason?: string;
} {
  return (
    isObjectRecord(value) &&
    typeof value.approvalId === 'string' &&
    typeof value.approved === 'boolean'
  );
}

function isToolResultOutput(value: unknown): boolean {
  if (!isObjectRecord(value) || typeof value.type !== 'string') return false;
  return ['text', 'json', 'execution-denied', 'error-text', 'error-json', 'content'].includes(
    value.type,
  );
}

function toAiSdkToolResultOutput(value: unknown): Record<string, unknown> {
  if (isToolResultOutput(value)) {
    return deepCloneJson(value, { type: 'json', value: null }) as Record<string, unknown>;
  }

  if (typeof value === 'string') {
    return { type: 'text', value };
  }

  if (isObjectRecord(value) && typeof value.status === 'string') {
    const outputType = value.status === 'ok' ? 'json' : 'error-json';
    return {
      type: outputType,
      value: deepCloneJson(value, {}),
    };
  }

  return {
    type: 'json',
    value: deepCloneJson(value, null),
  };
}

export function toAiSdkMessages(messages: LLMMessage[]): ModelMessage[] {
  // Each branch returns a structurally valid ModelMessage; the union is too
  // complex for TS to verify inline, so we assert the array at the end.
  const result = messages.map((m) => {
    if (m.role === 'tool') {
      const toolCallId = m.tool_call_id || 'unknown';
      const toolName = m.name || 'unknown';

      let parsedContent: unknown;
      try {
        parsedContent = JSON.parse(m.content);
      } catch {
        parsedContent = m.content;
      }

      if (isToolApprovalResponse(parsedContent)) {
        return {
          role: 'tool',
          content: [
            {
              type: 'tool-approval-response',
              approvalId: parsedContent.approvalId,
              approved: parsedContent.approved,
              ...(typeof parsedContent.reason === 'string' ? { reason: parsedContent.reason } : {}),
            },
          ],
        };
      }

      return {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId,
            toolName,
            output: toAiSdkToolResultOutput(parsedContent),
          },
        ],
      };
    }

    if (m.role === 'assistant') {
      const hasToolCalls = Array.isArray(m.tool_calls) && m.tool_calls.length > 0;
      const reasoningContent =
        typeof m.reasoning_content === 'string' && m.reasoning_content.length > 0
          ? m.reasoning_content
          : undefined;

      if (!hasToolCalls && !reasoningContent) {
        let content = m.content;
        if (content === undefined || content === null) {
          content = '';
        }
        if (typeof content !== 'string') {
          content = JSON.stringify(content);
        }

        return {
          role: 'assistant',
          content: content as string,
        };
      }

      const parts: Record<string, unknown>[] = [];
      if (reasoningContent) {
        parts.push({ type: 'reasoning', text: reasoningContent });
      }

      if (m.content && typeof m.content === 'string') {
        parts.push({ type: 'text', text: m.content });
      }

      for (const call of hasToolCalls ? m.tool_calls || [] : []) {
        const toolCallId = call?.id || 'unknown';
        const toolName = call?.function?.name || call?.name || 'unknown';
        const rawArgs = call?.function?.arguments;
        const input =
          typeof rawArgs === 'string'
            ? rawArgs.trim()
              ? safeParseJsonObject(rawArgs)
              : {}
            : (call?.input ?? call?.args ?? {});
        const providerOptions = isObjectRecord(call?.providerMetadata)
          ? (deepCloneJson(call.providerMetadata, {}) as Record<string, unknown>)
          : undefined;

        parts.push({
          type: 'tool-call',
          toolCallId,
          toolName,
          input: deepCloneJson(input, {}),
          ...(providerOptions ? { providerOptions } : {}),
        });
      }

      return {
        role: 'assistant',
        content: parts,
      };
    }

    let content = m.content;
    if (content === undefined || content === null) {
      content = '';
    }
    if (typeof content !== 'string') {
      content = JSON.stringify(content);
    }

    return {
      role: m.role as 'system' | 'user',
      content: content as string,
    };
  });
  return result as ModelMessage[];
}

export function toAiSdkToolSet(
  openAiTools: OpenAIToolDefinition[] | undefined,
  toolSpecs?: ToolSpec[],
): ToolSet | undefined {
  const tools: Record<string, ToolSet[string] & { outputSchema?: z.ZodTypeAny }> = {};

  if (Array.isArray(toolSpecs)) {
    for (const spec of toolSpecs) {
      const outputDesc = formatOutputSchema(spec.outputSchema);
      const description = `${spec.description}\n\nReturns: ${outputDesc}`;

      const openAiDef = toolToOpenAI(spec);
      const parameters = jsonSchema(openAiDef.function?.parameters ?? {});

      tools[spec.name] = {
        ...tool({
          description,
          inputSchema: parameters,
        }),
        outputSchema: spec.outputSchema ?? z.any(),
      } as ToolSet[string] & { outputSchema?: z.ZodTypeAny };
    }
  }

  if (Array.isArray(openAiTools)) {
    for (const t of openAiTools) {
      const fn = t?.function;
      const name = fn?.name;
      if (!name || typeof name !== 'string' || tools[name]) continue;

      const rawDesc = typeof fn?.description === 'string' ? fn.description : '';
      const description = `${rawDesc}\n\nReturns: any (dynamic)`.trim();

      tools[name] = {
        ...tool({
          description,
          inputSchema: jsonSchema(fn?.parameters ?? { type: 'object', properties: {} }),
        }),
        outputSchema: z.any(),
      } as ToolSet[string] & { outputSchema?: z.ZodTypeAny };
    }
  }

  return Object.keys(tools).length > 0 ? (tools as unknown as ToolSet) : undefined;
}

export function toOpenAiToolCalls(
  toolCalls: ToolCallInput[] | undefined,
): Record<string, unknown>[] | undefined {
  if (!Array.isArray(toolCalls) || toolCalls.length === 0) return undefined;

  const normalizeToolInput = (raw: unknown): unknown => {
    if (typeof raw !== 'string') return raw;

    const trimmed = raw.trim();
    if (!trimmed) return {};

    try {
      let parsed: unknown = JSON.parse(trimmed);
      if (typeof parsed === 'string') {
        const nested = parsed.trim();
        if (nested.startsWith('{') || nested.startsWith('[')) {
          try {
            parsed = JSON.parse(nested);
          } catch {
            // ignored
          }
        }
      }
      return parsed;
    } catch {
      return raw;
    }
  };

  return toolCalls.map((c) => {
    const providerMetadata = isObjectRecord(c?.providerMetadata)
      ? (deepCloneJson(c.providerMetadata, {}) as Record<string, unknown>)
      : undefined;

    return {
      id: c?.toolCallId || c?.id || 'unknown',
      type: 'function',
      function: {
        name: c?.toolName || c?.name || 'unknown',
        arguments: JSON.stringify(normalizeToolInput(c?.input ?? c?.args ?? {})),
      },
      ...(providerMetadata ? { providerMetadata } : {}),
    };
  });
}
