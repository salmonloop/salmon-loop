import { jsonSchema, tool } from 'ai';
import type { ToolSet } from 'ai';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

import { toolToOpenAI } from '../../tools/mapper.js';
import type { ToolSpec } from '../../tools/types.js';
import type { LLMMessage } from '../../types/llm.js';

function formatOutputSchema(schema: z.ZodType<any> | undefined): string {
  if (!schema) return 'any (dynamic)';

  const def = schema._def as any;
  if (def?.description) {
    return def.description;
  }

  try {
    const jsonSchemaObj = zodToJsonSchema(schema as any, {
      target: 'openApi3',
      $refStrategy: 'none',
    });

    if (jsonSchemaObj && typeof jsonSchemaObj === 'object') {
      const { $schema: _$schema, ...cleanSchema } = jsonSchemaObj as any;
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

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function extractUsageFromAiSdkResult(
  result: unknown,
): { promptTokens: number; completionTokens: number } | null {
  if (!isObjectRecord(result)) return null;

  const usage = (result as any).usage;
  if (!isObjectRecord(usage)) return null;

  const promptTokens = (usage as any).promptTokens ?? (usage as any).prompt_tokens;
  const completionTokens = (usage as any).completionTokens ?? (usage as any).completion_tokens;

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

export function toAiSdkMessages(messages: LLMMessage[]): any[] {
  return messages.map((m) => {
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
          role: m.role as any,
          content: content as string,
        };
      }

      const parts: any[] = [];
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
      role: m.role as any,
      content: content as string,
    };
  });
}

export function toAiSdkToolSet(
  openAiTools: any[] | undefined,
  toolSpecs?: ToolSpec[],
): ToolSet | undefined {
  const tools: Record<string, any> = {};

  if (Array.isArray(toolSpecs)) {
    for (const spec of toolSpecs) {
      const outputDesc = formatOutputSchema(spec.outputSchema);
      const description = `${spec.description}\n\nReturns: ${outputDesc}`;

      const openAiDef = toolToOpenAI(spec as any);
      const parameters = jsonSchema((openAiDef as any).function?.parameters || {});

      tools[spec.name] = tool({
        description,
        parameters,
      } as any);

      (tools[spec.name] as any).outputSchema = spec.outputSchema || z.any();
    }
  }

  if (Array.isArray(openAiTools)) {
    for (const t of openAiTools) {
      const fn = t?.function;
      const name = fn?.name;
      if (!name || typeof name !== 'string' || tools[name]) continue;

      const rawDesc = typeof fn?.description === 'string' ? fn.description : '';
      const description = `${rawDesc}\n\nReturns: any (dynamic)`.trim();

      tools[name] = tool({
        description,
        parameters: jsonSchema(fn?.parameters || { type: 'object', properties: {} }),
      } as any);

      (tools[name] as any).outputSchema = z.any();
    }
  }

  return Object.keys(tools).length > 0 ? (tools as ToolSet) : undefined;
}

export function toOpenAiToolCalls(toolCalls: any[] | undefined): any[] | undefined {
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
