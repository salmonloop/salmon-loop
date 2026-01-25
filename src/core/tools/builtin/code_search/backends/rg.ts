import { Backend } from '../../../capability/types';
import { parseRgJson } from '../parse/rg_json';
import { CodeSearchInputT, CodeSearchOutputT } from '../spec';

export const rgBackend: Backend<CodeSearchInputT, CodeSearchOutputT> = {
  id: 'rg',

  async isCompatible(ctx) {
    try {
      // Check if rg is available and working
      const res = await ctx.runner.execFile('rg', ['--version'], { timeoutMs: 1500 });
      return res.exitCode === 0;
    } catch {
      return false;
    }
  },

  normalizeInput(input) {
    // Ensure maxMatches is within reasonable limits
    return {
      ...input,
      maxMatches: Math.min(input.maxMatches ?? 100, 500),
    };
  },

  async run(input, ctx) {
    const cwd = input.cwd ?? ctx.repoRoot;
    const args = [
      '--json',
      '--line-number',
      '--column',
      '--max-count',
      String(input.maxMatches),
      input.pattern,
      '.',
    ];

    if (!input.isRegex) {
      args.unshift('--fixed-strings');
    }

    if (input.glob) {
      args.unshift('--glob', input.glob);
    }

    const res = await ctx.runner.execFile('rg', args, {
      cwd,
      timeoutMs: ctx.limits.timeoutMs,
      maxStdoutBytes: ctx.limits.maxOutputBytes,
    });

    if (res.timedOut) {
      return {
        ok: false,
        code: 'TIMEOUT',
        message: 'ripgrep execution timed out',
        retryable: true,
      };
    }

    // rg exit code 1 means "no matches found", which is a success in terms of execution
    if (res.exitCode !== 0 && res.exitCode !== 1) {
      return {
        ok: false,
        code: 'NONZERO_EXIT',
        message: `ripgrep exited with code ${res.exitCode}: ${res.stderr}`,
        retryable: true,
      };
    }

    try {
      const { matches, truncated } = parseRgJson(res.stdout, {
        maxMatches: input.maxMatches ?? 100,
      });
      return {
        ok: true,
        output: {
          matches,
          truncated,
          backend: 'rg',
          stats: { hits: matches.length },
        },
      };
    } catch (err: any) {
      return {
        ok: false,
        code: 'RUNTIME_ERROR',
        message: `Failed to parse ripgrep output: ${err.message}`,
        retryable: true,
      };
    }
  },
};
