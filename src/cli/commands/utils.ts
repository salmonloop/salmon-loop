import * as crypto from 'crypto';

/**
 * Parses input to provide a structured context for suggestions.
 */
export function parseSuggestionContext(input: string) {
  const trimmed = input.trimStart();
  const parts = trimmed.split(/\s+/);

  // argIndex always points to the current argument slot being filled
  // e.g., "/session " splits to ["/session", ""], argIndex is 1.
  const argIndex = parts.length - 1;
  const currentPrefix = parts[argIndex] || '';
  const isSpaceTrailing = input.endsWith(' ');

  return { argIndex, currentPrefix, isSpaceTrailing };
}

export function parseToken(tokens: string[], key: string): string | undefined {
  const prefix = `${key}=`;
  const token = tokens.find((t) => t.startsWith(prefix));
  if (!token) return undefined;
  return token.slice(prefix.length);
}

export function parseTokenList(tokens: string[], key: string): string[] | undefined {
  const raw = parseToken(tokens, key);
  if (!raw) return undefined;
  const values = raw
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
  return values.length > 0 ? values : undefined;
}

export function hashArgsInput(raw: string): string {
  let payload = raw;
  try {
    payload = JSON.stringify(JSON.parse(raw));
  } catch {
    payload = raw;
  }
  return crypto.createHash('sha256').update(payload).digest('hex');
}
