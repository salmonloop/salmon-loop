import { Diagnostic } from './types.js';

export function parseTscOutput(output: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const lines = output.split('\n');
  // Example: src/app.ts(10,5): error TS2322: Type 'string' is not assignable to type 'number'.
  const regex = /^(.+)\((\d+),(\d+)\): (error|warning) (TS\d+): (.+)$/;

  for (const line of lines) {
    const match = line.trim().match(regex);
    if (match) {
      diagnostics.push({
        file: match[1],
        line: parseInt(match[2]),
        column: parseInt(match[3]),
        severity: match[4] as 'error' | 'warning',
        message: `${match[5]}: ${match[6]}`,
        source: 'tsc',
      });
    }
  }
  return diagnostics;
}

export function parsePythonError(output: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const lines = output.split('\n');
  // Example: File "app.py", line 10, in <module>
  const fileRegex = /File "(.+)", line (\d+)/;

  let currentFile: string | null = null;
  let currentLine: number | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const fileMatch = line.match(fileRegex);
    if (fileMatch) {
      currentFile = fileMatch[1];
      currentLine = parseInt(fileMatch[2]);
    } else if (currentFile && (line.includes('Error:') || line.includes('Exception:'))) {
      diagnostics.push({
        file: currentFile,
        line: currentLine || undefined,
        severity: 'error',
        message: line,
        source: 'python',
      });
      currentFile = null;
      currentLine = null;
    }
  }
  return diagnostics;
}

export function parseGenericOutput(output: string): Diagnostic[] {
  // Fallback or combined parser
  const tsc = parseTscOutput(output);
  if (tsc.length > 0) return tsc;

  const py = parsePythonError(output);
  if (py.length > 0) return py;

  return [];
}
