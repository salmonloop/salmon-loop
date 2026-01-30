export type { LLM } from './types.js';

// Keep `src/core/llm.ts` as the stable import path for existing code/tests.
// Implementations live under `src/core/llm/` to match the project layout.
/**
 * @deprecated Use `AiSdkLLM` instead. Kept for backward compatibility only.
 */
export { OpenAILLM, StubLLM, FakeLLM } from './llm/openai.js';
export { AiSdkLLM } from './llm/ai-sdk.js';
