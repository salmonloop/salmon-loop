import type { SlashParseResult } from './types.js';

function parseSuggestionContext(input: string) {
  const trimmed = input.trimStart();
  const parts = trimmed.split(/\s+/);
  const argIndex = parts.length - 1;
  const currentPrefix = parts[argIndex] || '';
  const isSpaceTrailing = input.endsWith(' ');
  return { argIndex, currentPrefix, isSpaceTrailing };
}

export function parseSlashInput(input: string): SlashParseResult {
  const raw = input ?? '';
  const trimmed = raw.trim();
  const suggestion = parseSuggestionContext(raw);

  if (!trimmed) return { kind: 'text', raw, trimmed, suggestion };

  const trimmedStart = raw.trimStart();
  if (!trimmedStart.startsWith('/')) {
    return { kind: 'text', raw, trimmed, suggestion };
  }

  const first = trimmedStart.split(/\s+/)[0] ?? '';
  const normalized = first.toLowerCase();
  const argsText = trimmedStart.slice(first.length).trimStart();
  const tokens = argsText.length > 0 ? argsText.split(/\s+/) : [];

  return {
    kind: 'slash',
    raw,
    trimmed,
    commandName: normalized,
    argsText,
    tokens,
    suggestion,
  };
}
