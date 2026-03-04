import type { ApiKeySource } from './types.js';

export function firstNonEmpty(value: string | undefined | null): string | undefined {
  if (!value) return undefined;
  const v = value.trim();
  return v ? v : undefined;
}

export function parseBoolEnv(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  const raw = value.trim().toLowerCase();
  if (!raw) return undefined;
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

export function resolveApiKey(inlineKey: string | null | undefined): {
  key?: string;
  source: ApiKeySource;
} {
  const inline = firstNonEmpty(inlineKey || undefined);
  if (inline) return { key: inline, source: 'inline' };

  const env = process.env.SALMONLOOP_API_KEY || process.env.S8P_API_KEY;
  const envKey = firstNonEmpty(env);
  if (envKey) return { key: envKey, source: 'env' };

  return { source: 'missing' };
}

export function resolveModelId(configModelId?: string): string {
  return (
    firstNonEmpty(configModelId) ||
    firstNonEmpty(process.env.SALMONLOOP_MODEL) ||
    firstNonEmpty(process.env.S8P_MODEL) ||
    'gpt-4o'
  );
}

export function firstProviderRef(value: string | string[] | undefined): string | undefined {
  if (!value) return undefined;
  if (typeof value === 'string') return firstNonEmpty(value);
  for (const v of value) {
    const found = firstNonEmpty(v);
    if (found) return found;
  }
  return undefined;
}
