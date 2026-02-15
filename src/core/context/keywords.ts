// Hardcoded stopwords list (simplified)
const STOPWORDS = new Set([
  'the',
  'is',
  'a',
  'an',
  'to',
  'of',
  'and',
  'in',
  'on',
  'at',
  'for',
  'with',
  'fix',
  'add',
  'remove',
  'update',
  'delete',
  'create',
  'make',
  'implement',
  'please',
  'help',
  'todo',
  'bug',
  'issue',
  'error',
  'fail',
  'failed',
]);

function uniquePreserveOrder(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function extractPathLikeTokens(input: string): string[] {
  const matches = input.match(
    /(?:^|[\s"'`([{])((?:\.{0,2}\/)?[\w./-]+\.(?:ts|tsx|js|jsx|json|md|yml|yaml|css|scss|html))(?:$|[\s"'`)\]}.,;:])/g,
  );
  if (!matches) return [];
  return matches
    .map((m) => m.replace(/^[\s"'`([{]+/, '').replace(/[\s"'`)\]}.,;:]+$/, ''))
    .filter(Boolean);
}

function extractBacktickedTokens(input: string): string[] {
  const matches: string[] = [];
  const re = /`([^`]{1,64})`/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input)) !== null) {
    const val = m[1]?.trim();
    if (val) matches.push(val);
  }
  return matches;
}

function extractErrorLikeTokens(input: string): string[] {
  const matches: string[] = [];
  const re = /\b(ERR_[A-Z0-9_]{2,}|[A-Z][A-Za-z]+Error)\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input)) !== null) {
    if (m[1]) matches.push(m[1]);
  }
  return matches;
}

function extractIdentifierTokens(input: string): string[] {
  const matches: string[] = [];
  const re = /\b[A-Za-z_][A-Za-z0-9_]{2,}\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input)) !== null) {
    if (m[0]) matches.push(m[0]);
  }
  return matches;
}

function isCjk(char: string): boolean {
  return /\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}/u.test(char);
}

function extractCjkNgrams(input: string, n: number): string[] {
  const chars = Array.from(input).filter((c) => isCjk(c));
  if (chars.length < n) return [];

  const counts = new Map<string, number>();
  for (let i = 0; i <= chars.length - n; i++) {
    const gram = chars.slice(i, i + n).join('');
    counts.set(gram, (counts.get(gram) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([gram]) => gram);
}

export function extractKeywords(instruction: string): string[] {
  const raw = instruction.trim();
  if (!raw) return [];

  const pathLike = extractPathLikeTokens(raw);
  const backticked = extractBacktickedTokens(raw);
  const errorLike = extractErrorLikeTokens(raw);
  const identifiers = extractIdentifierTokens(raw);

  const wordTokens = raw
    .toLowerCase()
    .split(/[^\p{L}\p{N}_-]+/u)
    .filter(Boolean);

  const ordered = uniquePreserveOrder([
    ...pathLike,
    ...backticked,
    ...errorLike,
    ...identifiers,
    ...wordTokens,
  ]);

  const filtered = ordered
    .map((t) => t.trim())
    .filter(Boolean)
    .filter((t) => t.length >= 3)
    .filter((t) => !STOPWORDS.has(t.toLowerCase()));

  const selected = filtered.slice(0, 3);
  if (selected.length > 0) return selected;

  const hasCjk = Array.from(raw).some((c) => isCjk(c));
  if (!hasCjk) return [];

  const shortEnoughForNgrams = raw.length <= 60;
  if (!shortEnoughForNgrams) return [];

  const grams = uniquePreserveOrder([...extractCjkNgrams(raw, 3), ...extractCjkNgrams(raw, 2)]);
  return grams.slice(0, 3);
}
