/**
 * LLM implementations are swappable.
 * Core loop must NOT depend on provider-specific behavior.
 */
import type { Context, LLM, LLMMessage, Plan } from '../types/index.js';

export type { LLM };

export class StubLLM implements LLM {
  getCapabilities(): {
    toolCalling?: boolean;
    responseFormatJsonObject?: boolean;
    streaming?: boolean;
  } {
    return {
      toolCalling: false,
      responseFormatJsonObject: false,
      streaming: false,
    };
  }

  async chat(messages: LLMMessage[]): Promise<LLMMessage> {
    const lastMsg = messages[messages.length - 1];
    return {
      role: 'assistant',
      content: `Stub response for: ${lastMsg.content.substring(0, 50)}...`,
    };
  }

  async createPlan(_context: Context, instruction: string, _lastError?: string): Promise<Plan> {
    return {
      goal: `Implement functionality based on instruction "${instruction}"`,
      files: ['example.txt'],
      changes: ['Modify example file content'],
      verify: 'Check if changes are applied correctly',
    };
  }

  async createPatch(_context: Context, _plan: Plan, _lastError?: string): Promise<string> {
    return `diff --git a/example.txt b/example.txt
index 1234567..abcdefg 100644
--- a/example.txt
+++ b/example.txt
@@ -1,3 +1,3 @@
-Hello
+Hello World
 Test
-End
+End Test`;
  }
}

/**
 * A fake LLM for deterministic testing.
 */
export class FakeLLM implements LLM {
  constructor(
    private plans: Plan[],
    private patches: string[],
  ) {}

  private planIndex = 0;
  private patchIndex = 0;

  getCapabilities(): {
    toolCalling?: boolean;
    responseFormatJsonObject?: boolean;
    streaming?: boolean;
  } {
    return {
      toolCalling: false,
      responseFormatJsonObject: false,
      streaming: false,
    };
  }

  async chat(_messages: LLMMessage[]): Promise<LLMMessage> {
    return {
      role: 'assistant',
      content: 'Fake chat response',
    };
  }

  async createPlan(): Promise<Plan> {
    return this.plans[this.planIndex++] || this.plans[this.plans.length - 1];
  }

  async createPatch(): Promise<string> {
    return this.patches[this.patchIndex++] || this.patches[this.patches.length - 1];
  }
}
