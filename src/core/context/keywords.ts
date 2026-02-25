// Language-agnostic stopwords (common across languages)
const STOPWORDS = new Set([
  // English
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
  // Chinese common words
  '的',
  '了',
  '在',
  '是',
  '我',
  '有',
  '和',
  '就',
  '不',
  '人',
  '都',
  '一',
  '一个',
  '上',
  '也',
  '很',
  '到',
  '说',
  '要',
  '去',
  '你',
  '会',
  '着',
  '没有',
  '看',
  '好',
  '自己',
  '这',
  '那',
  '里',
  '什么',
  '怎么',
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
    // Filter out stopwords
    if (!STOPWORDS.has(gram)) {
      counts.set(gram, (counts.get(gram) ?? 0) + 1);
    }
  }

  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([gram]) => gram);
}

export function extractKeywords(instruction: string): string[] {
  const raw = instruction.trim();
  if (!raw) return [];

  // Priority 1: Path-like tokens (highest signal)
  const pathLike = extractPathLikeTokens(raw);

  // Priority 2: Backticked tokens (explicit emphasis)
  const backticked = extractBacktickedTokens(raw);

  // Priority 3: Error-like tokens (strong signal)
  const errorLike = extractErrorLikeTokens(raw);

  // Priority 4: Identifiers (code-related)
  const identifiers = extractIdentifierTokens(raw);

  // Priority 5: Word tokens
  const wordTokens = raw
    .toLowerCase()
    .split(/[^\p{L}\p{N}_-]+/u)
    .filter(Boolean);

  // Combine with priority order
  const ordered = uniquePreserveOrder([
    ...pathLike,
    ...backticked,
    ...errorLike,
    ...identifiers,
    ...wordTokens,
  ]);

  // Filter out stopwords and short tokens
  const filtered = ordered
    .map((t) => t.trim())
    .filter(Boolean)
    .filter((t) => t.length >= 2) // Reduced from 3 to support CJK
    .filter((t) => !STOPWORDS.has(t.toLowerCase()) && !STOPWORDS.has(t));

  // Take top 5 keywords (increased from 3)
  const selected = filtered.slice(0, 5);
  if (selected.length > 0) return selected;

  // Fallback: CJK n-grams
  const hasCjk = Array.from(raw).some((c) => isCjk(c));
  if (!hasCjk) return [];

  // Extract CJK n-grams (3-char and 2-char)
  const grams = uniquePreserveOrder([...extractCjkNgrams(raw, 3), ...extractCjkNgrams(raw, 2)]);
  return grams.slice(0, 5);
}
