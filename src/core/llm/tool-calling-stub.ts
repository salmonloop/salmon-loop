/**
 * ToolCallingStubLLM — A deterministic LLM stub that emits tool_calls
 * to drive the chatWithTools loop in tests and evaluation harnesses.
 *
 * Unlike StubLLM (toolCalling: false, no tool_calls), this stub populates
 * the assistant.tool_calls field so that chatWithTools executes tools and
 * continues the loop.
 */

import type { Context } from '../types/context.js';
import type { LLM, LlmCapabilities, LLMMessage } from '../types/llm.js';
import type { Plan } from '../types/planning.js';

export interface StubToolCall {
  id: string;
  function: {
    name: string;
    arguments: string;
  };
}

export interface StubTurn {
  /** Tool calls to emit. If undefined, emit text-only content (triggers loop exit). */
  toolCalls?: StubToolCall[];
  /** Text content for this turn. */
  content?: string;
}

export class ToolCallingStubLLM implements LLM {
  readonly toolCalling = true;
  private readonly turns: StubTurn[];
  private callCount = 0;

  constructor(turns: StubTurn[]) {
    this.turns = turns;
  }

  getCapabilities(): LlmCapabilities {
    return {
      toolCalling: true,
      responseFormatJsonObject: false,
      streaming: false,
    };
  }

  async chat(_messages: LLMMessage[]): Promise<LLMMessage> {
    const idx = this.callCount;
    const turn = this.turns[idx] ?? { content: '[stub: no more turns]' };
    this.callCount++;
    return {
      role: 'assistant',
      content: turn.content ?? '',
      tool_calls: turn.toolCalls,
    };
  }

  getCallCount(): number {
    return this.callCount;
  }

  async createPlan(_context: Context, instruction: string): Promise<Plan> {
    return {
      goal: `Stub plan for: ${instruction}`,
      files: [],
      changes: [],
      verify: 'echo ok',
    };
  }

  async createPatch(): Promise<string> {
    return '';
  }
}
