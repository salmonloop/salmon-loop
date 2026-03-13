export type OutputFormat = 'text' | 'json' | 'stream-json';

export function resolveOutputFormat(raw: string): OutputFormat | undefined {
  if (raw === 'text' || raw === 'stream-json' || raw === 'json') return raw;
  return undefined;
}
