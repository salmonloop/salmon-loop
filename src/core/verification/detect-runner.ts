/**
 * Test runner detection and JSON flag injection.
 *
 * Detects which test runner a command invokes and, when the runner
 * supports structured JSON output, rewrites the command to emit JSON
 * so downstream parsers can consume machine-readable data instead of
 * regex-matching human-friendly text.
 */

export type RunnerKind = 'jest' | 'vitest' | 'pytest' | 'tsc' | 'eslint' | 'bun' | 'go' | 'unknown';

// ── Detection ────────────────────────────────────────────────────────────────

/** Heuristic detection from the raw command string. */
export function detectRunner(command: string): RunnerKind {
  const cmd = command.toLowerCase();

  // Order matters: more specific patterns first
  if (/\bvitest\b/.test(cmd)) return 'vitest';
  if (/\bjest\b/.test(cmd)) return 'jest';
  if (/\bpytest\b/.test(cmd) || /\bpy\.test\b/.test(cmd)) return 'pytest';
  if (/\btsc\b/.test(cmd)) return 'tsc';
  if (/\beslint\b/.test(cmd)) return 'eslint';
  if (/\bbun\s+test\b/.test(cmd)) return 'bun';
  if (/\bgo\s+test\b/.test(cmd)) return 'go';

  // npm/pnpm/yarn script proxies — try to infer from script name
  if (/\bnpm\s+run\s+/.test(cmd) || /\bpnpm\s+/.test(cmd) || /\byarn\s+/.test(cmd)) {
    if (/test:unit|test:e2e|test:integration|test:full/.test(cmd)) return 'unknown';
    if (/\btest\b/.test(cmd)) return 'unknown'; // could be anything
  }

  return 'unknown';
}

// ── JSON flag injection ──────────────────────────────────────────────────────

/** Returns true when the runner supports structured JSON output. */
export function supportsJsonOutput(runner: RunnerKind): boolean {
  return (
    runner === 'jest' ||
    runner === 'vitest' ||
    runner === 'eslint' ||
    runner === 'bun' ||
    runner === 'go'
  );
}

/**
 * Rewrite the command to emit structured output.
 *
 * Only modifies commands for runners that support JSON.
 * Returns the original command unchanged when the runner
 * has no JSON mode (pytest, tsc) or is unknown.
 */
export function injectJsonFlags(command: string, runner: RunnerKind): string {
  switch (runner) {
    case 'jest':
      // jest --json --outputFile=/dev/null would suppress file write;
      // but --json alone prints to stdout which is what we want.
      // Avoid duplicating --json if already present.
      if (command.includes('--json')) return command;
      return `${command} --json`;

    case 'vitest':
      // vitest --reporter=json --run  (--run prevents watch mode)
      if (command.includes('--reporter=json') || command.includes('--reporter json'))
        return command;
      return `${command} --reporter=json --run`;

    case 'eslint':
      // eslint --format json
      if (command.includes('--format json') || command.includes('--format=json')) return command;
      return `${command} --format json`;

    case 'bun':
      // bun test --json  (outputs NDJSON to stdout)
      if (command.includes('--json')) return command;
      return `${command} --json`;

    case 'go':
      // go test -json
      if (command.includes('-json')) return command;
      return `${command} -json`;

    default:
      return command;
  }
}
