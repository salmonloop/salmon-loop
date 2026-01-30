const MAX_OUTLINE_LINES = 200;

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
