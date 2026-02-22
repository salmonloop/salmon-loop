import { Readable } from 'stream';

export interface BunRuntime {
  spawn: (cmd: string[], options: Record<string, unknown>) => any;
  which?: (cmd: string) => string | null | undefined;
}

export function getBunRuntime(): BunRuntime | undefined {
  const runtime = (globalThis as { Bun?: unknown }).Bun as BunRuntime | undefined;
  if (!runtime || typeof runtime.spawn !== 'function') {
    return undefined;
  }
  return runtime;
}

export function normalizeSignal(value: unknown): NodeJS.Signals | null {
  if (typeof value === 'string') {
    return value as NodeJS.Signals;
  }
  return null;
}

export function toNodeReadableStream(stream: unknown): NodeJS.ReadableStream | undefined {
  if (!stream) return undefined;
  if (typeof (stream as { on?: unknown }).on === 'function') {
    return stream as NodeJS.ReadableStream;
  }
  if (typeof (stream as { getReader?: unknown }).getReader === 'function') {
    return Readable.fromWeb(stream as any) as unknown as NodeJS.ReadableStream;
  }
  return undefined;
}
