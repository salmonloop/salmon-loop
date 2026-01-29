export interface PlainMatch {
  file: string;
  line: number;
  column?: number;
  snippet: string;
}

/**
 * A versatile parser for non-JSON-native search tools.
 * Supports PowerShell JSON objects and traditional line-based formats.
 */
export function parsePlainMatches(
  stdout: string,
  opts: { format: 'ps-json' | 'findstr'; maxMatches: number },
): { matches: PlainMatch[]; truncated: boolean } {
  if (opts.format === 'ps-json') {
    return parsePsJson(stdout, opts.maxMatches);
  }
  return parseLineBased(stdout, opts.maxMatches);
}

function parsePsJson(stdout: string, maxMatches: number) {
  const matches: PlainMatch[] = [];
  let truncated = false;

  try {
    // PowerShell's ConvertTo-Json might return a single object or an array
    const raw = JSON.parse(stdout);
    const items = Array.isArray(raw) ? raw : [raw];

    for (const item of items) {
      if (matches.length >= maxMatches) {
        truncated = true;
        break;
      }
      if (item.Path && item.LineNumber) {
        matches.push({
          file: item.Path,
          line: item.LineNumber,
          snippet: (item.Line || '').trimEnd(),
        });
      }
    }
  } catch {
    // If JSON parsing fails, fallback to empty
  }

  return { matches, truncated };
}

function parseLineBased(stdout: string, maxMatches: number) {
  const lines = stdout.split('\n').filter((l) => l.trim());
  const matches: PlainMatch[] = [];
  let truncated = false;

  for (const line of lines) {
    if (matches.length >= maxMatches) {
      truncated = true;
      break;
    }

    // Typical format: "path/to/file:line:content"
    const parts = line.split(':');
    if (parts.length >= 3) {
      const file = parts[0].trim();
      const lineNum = parseInt(parts[1], 10);
      const snippet = parts.slice(2).join(':').trimEnd();

      if (!isNaN(lineNum)) {
        matches.push({ file, line: lineNum, snippet });
      }
    }
  }

  return { matches, truncated };
}
