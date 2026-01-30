export interface WhitespaceNormalizeOptions {
  maxConsecutiveBlankLines?: number;
  trimFinalNewline?: boolean;
}

export function normalizeWhitespace(
  input: string,
  options: WhitespaceNormalizeOptions = {},
): string {
  const maxConsecutiveBlankLines = options.maxConsecutiveBlankLines ?? 1;
  const trimFinalNewline = options.trimFinalNewline ?? true;

  const normalizedNewlines = input.replace(/\r\n/g, '\n');
  const lines = normalizedNewlines.split('\n').map((l) => l.replace(/[ \t]+$/g, ''));

  const out: string[] = [];
  let blankRun = 0;

  for (const line of lines) {
    const isBlank = line.trim().length === 0;
    if (isBlank) {
      blankRun++;
      if (blankRun <= maxConsecutiveBlankLines) out.push('');
      continue;
    }
    blankRun = 0;
    out.push(line);
  }

  let result = out.join('\n');
  result = result.replace(/^\n+/, '').replace(/\n+$/, '');
  if (!trimFinalNewline) {
    result += '\n';
  }
  return result;
}
