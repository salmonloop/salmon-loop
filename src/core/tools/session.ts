import * as crypto from 'crypto';

import type { ToolCallingAuditSink } from '../llm/audit.js';
import { redactErrorMessage, redactJsonString, redactValue } from '../llm/redact.js';
import { logger } from '../logger.js';
import type { ChatOptions, LLM, LLMMessage } from '../types.js';
import { ExecutionPhase } from '../types.js';

import { toolToOpenAI } from './mapper.js';
import type { ToolRuntimeCtx, ToolResult } from './types.js';

export interface ToolCallingSessionOptions {
  phase: ExecutionPhase;
  llm: LLM;
  runtime: ToolRuntimeCtx;
  toolstack: {
    registry: { listAll(): any[] };
    policy: { decide(phase: ExecutionPhase, spec: any, ctx: { worktreeRoot?: string }): any };
    router: { call(envelope: any): Promise<ToolResult> };
  };
  toolCallingAudit?: ToolCallingAuditSink;
  emit?: (event: {
    type: 'log';
    level: 'debug' | 'info' | 'warn' | 'error';
    message: string;
  }) => void;
  maxRounds?: number;
}

function safeParseJson(argsText: unknown): { ok: true; value: any } | { ok: false; error: string } {
  if (typeof argsText !== 'string') {
    return { ok: true, value: argsText };
  }
  if (!argsText.trim()) {
    return { ok: true, value: {} };
  }
  try {
    return { ok: true, value: JSON.parse(argsText) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

function formatToolResultForModel(result: ToolResult): string {
  const payload = {
    id: result.id,
    toolName: result.toolName,
    status: result.status,
    output: result.output,
    summary: result.summary,
    error: result.error,
    meta: result.meta,
    durationMs: result.durationMs,
  };
  try {
    return JSON.stringify(payload);
  } catch {
    return JSON.stringify({
      id: result.id,
      toolName: result.toolName,
      status: 'error',
      error: {
        code: 'SERIALIZE_ERROR',
        message: 'Failed to serialize tool result',
        retryable: false,
      },
    });
  }
}

function safeStringifyForAudit(value: unknown): string {
  try {
    return redactJsonString(JSON.stringify(redactValue(value)));
  } catch {
    return '[Unserializable]';
  }
}

/**
 * Runs an OpenAI-style tool calling loop:
 * - Send messages (+ tools)
 * - If assistant returns tool_calls, execute them via ToolRouter
 * - Feed tool results back as role='tool' messages
 * - Repeat until no tool_calls or maxRounds reached
 */
export async function chatWithTools(
  initialMessages: LLMMessage[],
  chatOptions: ChatOptions,
  session: ToolCallingSessionOptions,
): Promise<LLMMessage> {
  const maxRounds = session.maxRounds ?? 6;
  const phase = session.phase;

  const allowedSpecs = session.toolstack.registry.listAll().filter((spec) => {
    return session.toolstack.policy.decide(phase, spec, {
      worktreeRoot: session.runtime.worktreeRoot,
    }).allowed;
  });

  const openAITools = allowedSpecs.map(toolToOpenAI);

  if (openAITools.length > 0) {
    session.emit?.({
      type: 'log',
      level: 'debug',
      message: `Tool calling enabled (${openAITools.length} tools available)`,
    });
  }

  const messages: LLMMessage[] = [...initialMessages];

  for (let round = 0; round < maxRounds; round++) {
    const assistant = await session.llm.chat(messages, {
      ...chatOptions,
      tools: openAITools,
      toolChoice: openAITools.length > 0 ? 'auto' : undefined,
    });

    messages.push({
      role: 'assistant',
      content: assistant.content || '',
      tool_calls: assistant.tool_calls,
    });

    const toolCalls = assistant.tool_calls || [];
    if (!Array.isArray(toolCalls) || toolCalls.length === 0) {
      return assistant;
    }

    for (const call of toolCalls) {
      const callId = call?.id || crypto.randomUUID();
      const toolName = call?.function?.name;
      const rawArgs = call?.function?.arguments;

      if (!toolName || typeof toolName !== 'string') {
        logger.warn('Received malformed tool call (missing function.name)');
        session.toolCallingAudit?.event({
          timestamp: new Date().toISOString(),
          phase,
          round,
          callId,
          toolName: 'unknown',
          rawArgsType: typeof rawArgs,
          rawArgsPreview: typeof rawArgs === 'string' ? redactJsonString(rawArgs) : undefined,
          parsedArgsOk: false,
          parsedArgsError: 'Missing function.name',
          toolResultStatus: 'error',
          toolResultErrorCode: 'MALFORMED_TOOL_CALL',
        });
        messages.push({
          role: 'tool',
          name: 'unknown',
          tool_call_id: callId,
          content: JSON.stringify({
            status: 'error',
            error: {
              code: 'MALFORMED_TOOL_CALL',
              message: 'Missing function.name',
              retryable: true,
            },
          }),
        });
        continue;
      }

      session.emit?.({
        type: 'log',
        level: 'debug',
        message: `Tool call requested: ${toolName}`,
      });

      const parsed = safeParseJson(rawArgs);
      let result: ToolResult;

      if (!parsed.ok) {
        session.toolCallingAudit?.event({
          timestamp: new Date().toISOString(),
          phase,
          round,
          callId,
          toolName,
          rawArgsType: typeof rawArgs,
          rawArgsPreview: typeof rawArgs === 'string' ? redactJsonString(rawArgs) : undefined,
          parsedArgsOk: false,
          parsedArgsError: redactErrorMessage(parsed.error),
          toolResultStatus: 'error',
          toolResultErrorCode: 'INVALID_TOOL_ARGUMENTS_JSON',
        });
        result = {
          id: callId,
          toolName,
          source: 'builtin',
          status: 'error',
          error: {
            code: 'INVALID_TOOL_ARGUMENTS_JSON',
            message: parsed.error,
            retryable: true,
            failurePhase: phase,
          },
        };
      } else {
        session.toolCallingAudit?.event({
          timestamp: new Date().toISOString(),
          phase,
          round,
          callId,
          toolName,
          rawArgsType: typeof rawArgs,
          rawArgsPreview: typeof rawArgs === 'string' ? redactJsonString(rawArgs) : undefined,
          parsedArgsOk: true,
          parsedArgsPreview: safeStringifyForAudit(parsed.value),
        });
        result = await session.toolstack.router.call({
          id: callId,
          phase,
          toolName,
          args: parsed.value,
          ctx: session.runtime,
        });
        if (result.status !== 'ok') {
          session.toolCallingAudit?.event({
            timestamp: new Date().toISOString(),
            phase,
            round,
            callId,
            toolName,
            rawArgsType: typeof rawArgs,
            parsedArgsOk: true,
            toolResultStatus: result.status,
            toolResultErrorCode: result.error?.code,
          });
        }
      }

      messages.push({
        role: 'tool',
        name: toolName,
        tool_call_id: callId,
        content: formatToolResultForModel(result),
      });
    }
  }

  // If we reach here, the model is stuck in tool calling. Return the last assistant content.
  session.emit?.({
    type: 'log',
    level: 'warn',
    message: `Tool calling exceeded maximum rounds (${maxRounds}); continuing without further tool execution`,
  });

  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
  return lastAssistant || { role: 'assistant', content: '' };
}
