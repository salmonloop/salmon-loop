export interface RgMatch {
  file: string;
  line: number;
  column?: number;
  snippet: string;
}

/**
 * Parses the newline-delimited JSON output from ripgrep (--json).
 */
export function parseRgJson(
  stdout: string,
  opts: { maxMatches: number },
): { matches: RgMatch[]; truncated: boolean } {
  const lines = stdout.split('\n').filter((l) => l.trim());
  const matches: RgMatch[] = [];
  let truncated = false;

  for (const line of lines) {
    if (matches.length >= opts.maxMatches) {
      truncated = true;
      break;
    }

    try {
      const data = JSON.parse(line);
      if (data.type === 'match') {
        matches.push({
          file: data.data.path.text,
          line: data.data.line_number,
          // rg column is 0-indexed in JSON, we convert to 1-indexed for the spec
          column: (data.data.submatches[0]?.start ?? 0) + 1,
          snippet: data.data.lines.text.trimEnd(),
        });
      }
    } catch {
      // Ignore malformed JSON lines
    }
  }

  return { matches, truncated };
}
