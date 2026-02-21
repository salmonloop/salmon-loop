import { redactValue } from '../llm/redact.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function limitValue(
  value: unknown,
  params: { depth: number; maxDepth: number; maxKeys: number; maxArray: number },
): unknown {
  if (params.depth >= params.maxDepth) return '[Truncated]';

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (value === null || value === undefined) return value;

  if (Array.isArray(value)) {
    const sliced = value.slice(0, params.maxArray);
    return sliced.map((v) => limitValue(v, { ...params, depth: params.depth + 1 }));
  }

  if (isRecord(value)) {
    const keys = Object.keys(value).sort().slice(0, params.maxKeys);
    const out: Record<string, unknown> = {};
    for (const key of keys) {
      out[key] = limitValue(value[key], { ...params, depth: params.depth + 1 });
    }
    return out;
  }

  return '[Unserializable]';
}

export function buildHeadlessToolInputPayload(value: unknown): Record<string, unknown> | undefined {
  const redacted = redactValue(value);
  const limited = limitValue(redacted, {
    depth: 0,
    maxDepth: 5,
    maxKeys: 40,
    maxArray: 40,
  });
  return isRecord(limited) ? limited : undefined;
}
