import { generateText, streamText } from 'ai';
import type { ToolSet } from 'ai';

import { recordAuditEvent } from '../../observability/audit-trail.js';
import type { ChatOptions, LLMMessage, LLMStreamChunk } from '../../types/llm.js';

import { extractUsageFromAiSdkResult } from './message-mapper.js';
import { buildAiSdkRequestParams } from './request-params.js';
import {
  executeAiSdkAttempt,
  executeAiSdkStreamAttempt,
  prepareAiSdkAttempt,
  type PreparedAiSdkAttempt,
} from './request-runtime.js';
import { mapAiSdkGenerateResultToMessage, mapAiSdkStreamResultToChunks } from './result-mapper.js';
import { executeWithAiSdkRetry, executeWithAiSdkStreamRetry } from './retry-executor.js';

interface BaseAiSdkChatExecutionInput {
  model: any;
  modelId: string;
  timeoutMs?: number;
  langfuseEnabled: boolean;
  requestId: string;
  messages: any[];
  tools?: ToolSet;
  options: ChatOptions;
}

export async function executeAiSdkChatRequest(
  input: BaseAiSdkChatExecutionInput,
): Promise<LLMMessage> {
  let attempt = 0;

  return executeWithAiSdkRetry({
    signal: input.options.signal,
    modelId: input.modelId,
    streamed: false,
    run: async () => {
      attempt += 1;
      return executeAiSdkAttempt({
        requestId: input.requestId,
        modelId: input.modelId,
        attempt,
        streamed: false,
        prepare: () =>
          prepareAiSdkAttempt({
            timeoutMs: input.timeoutMs,
            externalSignal: input.options.signal,
            langfuseEnabled: input.langfuseEnabled,
            requestId: input.requestId,
            attempt,
            tools: input.tools,
          }),
        run: async (attemptCtx) => {
          const result = await generateText(
            buildAiSdkRequestParams({
              model: input.model,
              messages: input.messages,
              tools: input.tools,
              options: input.options,
              headers: attemptCtx.langfuseHeaders,
              abortSignal: attemptCtx.abortSignal,
            }),
          );

          const usage = extractUsageFromAiSdkResult(result);
          if (usage) {
            recordAuditEvent('llm.usage', usage, {
              source: 'llm',
              severity: 'low',
              scope: 'session',
            });
          }

          return mapAiSdkGenerateResultToMessage(result as any);
        },
      });
    },
  });
}

export async function* executeAiSdkChatStreamRequest(
  input: BaseAiSdkChatExecutionInput,
): AsyncIterable<LLMStreamChunk> {
  let attempt = 0;

  const streamFactory = () => {
    attempt += 1;
    return executeAiSdkStreamAttempt({
      requestId: input.requestId,
      modelId: input.modelId,
      attempt,
      streamed: true,
      prepare: () =>
        prepareAiSdkAttempt({
          timeoutMs: input.timeoutMs,
          externalSignal: input.options.signal,
          langfuseEnabled: input.langfuseEnabled,
          requestId: input.requestId,
          attempt,
          tools: input.tools,
        }),
      run: async function* (attemptCtx: PreparedAiSdkAttempt) {
        const result = await streamText(
          buildAiSdkRequestParams({
            model: input.model,
            messages: input.messages,
            tools: input.tools,
            options: input.options,
            headers: attemptCtx.langfuseHeaders,
            abortSignal: attemptCtx.abortSignal,
          }),
        );
        yield* mapAiSdkStreamResultToChunks((result as any).fullStream);
      },
    });
  };

  yield* executeWithAiSdkStreamRetry({
    run: streamFactory,
    signal: input.options.signal,
    modelId: input.modelId,
  });
}
