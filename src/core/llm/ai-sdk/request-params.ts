import type { ChatOptions } from '../../types/llm.js';

export function buildAiSdkRequestParams(params: {
  model: any;
  messages: any[];
  tools?: any;
  options: ChatOptions;
  headers: Record<string, string>;
  abortSignal: AbortSignal;
}): any {
  return {
    model: params.model,
    messages: params.messages,
    tools: params.tools,
    temperature: params.options.temperature,
    maxOutputTokens: params.options.maxTokens,
    stopSequences: params.options.stop,
    toolChoice:
      params.options.toolChoice === 'none' ? 'none' : params.tools ? ('auto' as const) : undefined,
    headers: params.headers,
    abortSignal: params.abortSignal,
  };
}
