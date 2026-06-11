import { extractSkeleton } from './skeleton-extractor.js';

const MAX_OUTLINE_LINES = 200;

/**
 * Generate an outline/skeleton of source code.
 *
 * When a language plugin with tree-sitter support is available, uses AST-based
 * skeleton extraction (signature-only for definitions, full lines for imports).
 * Falls back to regex-based line filtering for unsupported languages.
 */
export async function outlineSourceAsync(sourceCode: string, lang?: string): Promise<string> {
  if (lang) {
    const skeleton = await extractSkeleton(sourceCode, lang);
    if (skeleton) return skeleton;
  }
  return outlineSource(sourceCode);
}

/**
 * Regex-based outline generator (fallback for unsupported languages).
 * Recognizes JS/TS-style keywords: function, class, interface, type, enum,
 * const/let/var declarations, import/export statements.
 */
export function outlineSource(sourceCode: string): string {
  const lines = sourceCode.split('\n');
  const out: string[] = [];

  const include = (line: string) => {
    if (out.length >= MAX_OUTLINE_LINES) return;
    out.push(line);
  };

  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;

    if (t.startsWith('import ') || t.startsWith('export ')) {
      include(line);
      continue;
    }

    if (
      /^\s*(?:export\s+)?(?:declare\s+)?(interface|type|class|enum|function)\b/.test(line) ||
      /^\s*(?:export\s+)?(?:const|let|var)\s+[A-Za-z0-9_$]+\s*[:=]/.test(line)
    ) {
      include(line);
    }
  }

  return out.join('\n').trim();
}
