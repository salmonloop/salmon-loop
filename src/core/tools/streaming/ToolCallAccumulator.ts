import type { LLMStreamChunk } from '../../types.js';

export class ToolCallAccumulator {
  private pending: any[] = [];

  addChunk(chunk: LLMStreamChunk): void {
    if (!chunk?.tool_calls || !Array.isArray(chunk.tool_calls)) {
      return;
    }
    this.pending.push(...chunk.tool_calls);
  }

  drain(): any[] {
    if (this.pending.length === 0) return [];
    const calls = [...this.pending];
    this.pending.length = 0;
    return calls;
  }

  hasAccumulated(): boolean {
    return this.pending.length > 0;
  }
}
