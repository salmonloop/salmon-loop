export function extractImportSpecifiers(sourceCode: string): string[] {
  const matches: Array<{ index: number; value: string }> = [];

  const collect = (re: RegExp) => {
    for (const match of sourceCode.matchAll(re)) {
      const value = (match[1] ?? '').trim();
      if (!value) continue;
      matches.push({ index: match.index ?? 0, value });
    }
  };

  // ESM: import ... from 'x'; / import 'x';
  collect(/\bimport\s+(?:type\s+)?(?:[^'"]+?\s+from\s+)?['"]([^'"]+)['"]/g);

  // CJS: require('x')
  collect(/\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g);

  // Dynamic: import('x')
  collect(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g);

  matches.sort((a, b) => a.index - b.index);

  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of matches) {
    if (seen.has(m.value)) continue;
    seen.add(m.value);
    out.push(m.value);
  }

  return out;
}
