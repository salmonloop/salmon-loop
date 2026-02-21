function findFirstJsonStart(text: string): number {
  const obj = text.indexOf('{');
  const arr = text.indexOf('[');
  if (obj === -1) return arr;
  if (arr === -1) return obj;
  return Math.min(obj, arr);
}

function findMatchingJsonEnd(text: string, start: number): number | null {
  const open = text[start];
  const close = open === '{' ? '}' : open === '[' ? ']' : '';
  if (!close) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\\\') {
        escaped = true;
        continue;
      }
      if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === open) depth += 1;
    if (ch === close) depth -= 1;

    if (depth === 0) return i;
  }

  return null;
}

/**
 * Best-effort strict JSON extraction from a text blob.
 *
 * - Finds the first '{' or '['
 * - Extracts a balanced JSON substring
 * - Parses via JSON.parse (no "repair" / lenient parsing)
 */
export function extractFirstJsonValueFromText(text: string): unknown | null {
  const raw = String(text ?? '');
  const start = findFirstJsonStart(raw);
  if (start === -1) return null;

  const end = findMatchingJsonEnd(raw, start);
  if (end == null) return null;

  const slice = raw.slice(start, end + 1);
  try {
    return JSON.parse(slice);
  } catch {
    return null;
  }
}
