import type { LLM, LlmCapabilities } from '../types/llm.js';
import type { ExecutionPhase } from '../types/runtime.js';

export function resolveLlmCapabilities(llm: LLM, phase?: ExecutionPhase): LlmCapabilities {
  return llm.getCapabilities?.({ phase }) ?? {};
}

export function supportsLlmStreaming(llm: LLM, phase?: ExecutionPhase): boolean {
  const capabilities = resolveLlmCapabilities(llm, phase);
  if (capabilities.streaming === false) return false;
  if (capabilities.streaming === true) return typeof llm.chatStream === 'function';
  return typeof llm.chatStream === 'function';
}
