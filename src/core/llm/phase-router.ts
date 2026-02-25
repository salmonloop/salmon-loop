import type {
  ChatOptions,
  Context,
  ExecutionPhase,
  LLM,
  LLMMessage,
  LLMStreamChunk,
} from '../types/index.js';
import { Phase, type Plan } from '../types/index.js';

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
    getCapabilities() {
      const base = defaultLlm.getCapabilities?.() ?? {};
      const hasToolCalling = Object.values(phaseLlms).some(
        (llm) => llm?.getCapabilities?.().toolCalling,
      );
      const hasStreaming = Object.values(phaseLlms).some(
        (llm) => llm?.getCapabilities?.().streaming,
      );
      const hasJsonMode = Object.values(phaseLlms).some(
        (llm) => llm?.getCapabilities?.().responseFormatJsonObject,
      );
      return {
        toolCalling: base.toolCalling || hasToolCalling,
        streaming: base.streaming || hasStreaming,
        responseFormatJsonObject: base.responseFormatJsonObject || hasJsonMode,
      };
    },
    createPlan(
      context: Context,
      instruction: string,
      lastError?: string,
      signal?: AbortSignal,
    ): Promise<Plan> {
      return resolve(Phase.PLAN).createPlan(context, instruction, lastError, signal);
    },
    createPatch(
      context: Context,
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
      if (selected.chatStream) {
        yield* selected.chatStream(messages, options);
        return;
      }

      const fallback = await selected.chat(messages, options);
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
