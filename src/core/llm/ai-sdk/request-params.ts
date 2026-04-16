import type { ToolSet, generateText } from 'ai';

import type { ChatOptions } from '../../types/llm.js';

type GenerateTextParams = Parameters<typeof generateText>[0];
type GenerateToolChoice = GenerateTextParams extends { toolChoice?: infer T } ? T : never;

export function buildAiSdkRequestParams(params: {
  model: any;
  messages: any[];
  tools?: ToolSet;
  options: ChatOptions;
  headers: Record<string, string>;
  abortSignal: AbortSignal;
}) {
  return {
    model: params.model,
    messages: params.messages,
    tools: params.tools,
    temperature: params.options.temperature,
    maxOutputTokens:
      params.options.maxTokens != null ? Number(params.options.maxTokens) : undefined,
    stopSequences: params.options.stop,
    toolChoice: (params.options.toolChoice === 'none'
      ? 'none'
      : params.tools
        ? 'auto'
        : undefined) as GenerateToolChoice,
    headers: params.headers,
    abortSignal: params.abortSignal,
  };
}
