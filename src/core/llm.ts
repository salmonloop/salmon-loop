import type { Context, Plan } from './types.js';

export interface LLM {
  createPlan(context: Context, instruction: string): Promise<Plan>;
  createPatch(context: Context, plan: Plan, lastError?: string): Promise<string>;
}

export class StubLLM implements LLM {
  async createPlan(context: Context, instruction: string): Promise<Plan> {
    // Return fixed Plan structure
    return {
      goal: `Implement functionality based on instruction "${instruction}"`,
      files: ['example.txt'],
      changes: ['Modify example file content'],
      verify: 'Check if changes are applied correctly'
    };
  }

  async createPatch(context: Context, plan: Plan, lastError?: string): Promise<string> {
    // Return example diff
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