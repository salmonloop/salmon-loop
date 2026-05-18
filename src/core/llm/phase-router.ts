import type { Context as ContextType } from '../types/context.js';
import type {
  ChatOptions,
  LLM,
  LlmCapabilities,
  LLMMessage,
  LLMStreamChunk,
} from '../types/llm.js';
import type { Plan } from '../types/planning.js';
import { Phase, type ExecutionPhase } from '../types/runtime.js';

type PhaseLlmMap = Partial<Record<ExecutionPhase, LLM>>;

export function createPhaseRoutingLlm(params: { defaultLlm: LLM; phaseLlms: PhaseLlmMap }): LLM {
  const { defaultLlm, phaseLlms } = params;

  const resolve = (phase?: ExecutionPhase): LLM => {
    if (!phase) return defaultLlm;
    return phaseLlms[phase] ?? defaultLlm;
  };

  const hasAnyStreaming =
    typeof defaultLlm.chatStream === 'function' ||
    Object.values(phaseLlms).some((llm) => typeof llm?.chatStream === 'function');

  const routed: LLM = {
    chat(messages: LLMMessage[], options?: ChatOptions): Promise<LLMMessage> {
      return resolve(options?.phase).chat(messages, options);
    },
    getCapabilities(options?: { phase?: ExecutionPhase }): LlmCapabilities {
      const selected = resolve(options?.phase);
      return selected.getCapabilities?.(options) ?? {};
    },
    createPlan(
      context: ContextType,
      instruction: string,
      lastError?: string,
      signal?: AbortSignal,
    ): Promise<Plan> {
      return resolve(Phase.PLAN).createPlan(context, instruction, lastError, signal);
    },
    createPatch(
      context: ContextType,
      plan: Plan,
      lastError?: string,
      signal?: AbortSignal,
    ): Promise<string> {
      return resolve(Phase.PATCH).createPatch(context, plan, lastError, signal);
    },
  };

  if (hasAnyStreaming) {
    routed.chatStream = async function* (
      messages: LLMMessage[],
      options?: ChatOptions,
    ): AsyncIterable<LLMStreamChunk> {
      const selected = resolve(options?.phase);
      const capabilities = selected.getCapabilities?.(options) ?? {};
      if (capabilities.streaming === false) {
        const fallback = await selected.chat(messages, options);
        if (fallback.reasoning_content) {
          yield {
            role: 'assistant',
            source: 'synthesized',
            reasoningDelta: fallback.reasoning_content,
          };
        }
        if (fallback.content) {
          yield { role: 'assistant', source: 'synthesized', contentDelta: fallback.content };
        }
        if (Array.isArray(fallback.tool_calls) && fallback.tool_calls.length > 0) {
          yield { role: 'assistant', source: 'synthesized', tool_calls: fallback.tool_calls };
        }
        yield { role: 'assistant', source: 'synthesized', done: true, finishReason: 'stop' };
        return;
      }

      if (selected.chatStream) {
        yield* selected.chatStream(messages, options);
        return;
      }

      const fallback = await selected.chat(messages, options);
      if (fallback.reasoning_content) {
        yield {
          role: 'assistant',
          source: 'synthesized',
          reasoningDelta: fallback.reasoning_content,
        };
      }
      if (fallback.content) {
        yield { role: 'assistant', source: 'synthesized', contentDelta: fallback.content };
      }
      if (Array.isArray(fallback.tool_calls) && fallback.tool_calls.length > 0) {
        yield { role: 'assistant', source: 'synthesized', tool_calls: fallback.tool_calls };
      }
      yield { role: 'assistant', source: 'synthesized', done: true, finishReason: 'stop' };
    };
  }

  if (defaultLlm.getModelId) {
    routed.getModelId = () => defaultLlm.getModelId!();
  }

  return routed;
}
