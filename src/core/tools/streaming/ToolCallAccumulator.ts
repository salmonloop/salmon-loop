import type { LLMStreamChunk } from '../../types/llm.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function mergeToolCall(prev: unknown, next: unknown): unknown {
  if (!isRecord(next)) return prev ?? next;
  if (!isRecord(prev)) return next;

  const prevFn = isRecord(prev.function) ? prev.function : null;
  const nextFn = isRecord(next.function) ? next.function : null;

  const mergedFn: Record<string, unknown> = {};
  if (prevFn) Object.assign(mergedFn, prevFn);
  if (nextFn) Object.assign(mergedFn, nextFn);

  const merged: Record<string, unknown> = { ...prev, ...next };
  if (prevFn || nextFn) merged.function = mergedFn;
  return merged;
}

export class ToolCallAccumulator {
  private readonly orderedIds: string[] = [];
  private readonly byId = new Map<string, unknown>();
  private readonly unkeyed: unknown[] = [];

  append(chunk: LLMStreamChunk): void {
    if (!chunk?.tool_calls || !Array.isArray(chunk.tool_calls)) {
      return;
    }

    for (const call of chunk.tool_calls) {
      if (!isRecord(call)) {
        this.unkeyed.push(call);
        continue;
      }
      const id = typeof call.id === 'string' ? call.id : null;
      if (!id) {
        this.unkeyed.push(call);
        continue;
      }

      const existing = this.byId.get(id);
      if (!existing) this.orderedIds.push(id);
      this.byId.set(id, mergeToolCall(existing, call));
    }
  }

  drain(): any[] {
    if (this.byId.size === 0 && this.unkeyed.length === 0) return [];

    const out: unknown[] = [];
    for (const id of this.orderedIds) {
      const call = this.byId.get(id);
      if (call) out.push(call);
    }
    out.push(...this.unkeyed);

    this.orderedIds.length = 0;
    this.byId.clear();
    this.unkeyed.length = 0;

    return out as any[];
  }

  hasAccumulated(): boolean {
    return this.byId.size > 0 || this.unkeyed.length > 0;
  }
}
