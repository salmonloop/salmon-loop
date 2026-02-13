import { LIMITS } from '../../../../config/limits.js';
import { Backend } from '../../../capability/types.js';
import { parsePlainMatches } from '../parse/plain-grep.js';
import { CodeSearchInputT, CodeSearchOutputT } from '../spec.js';

export const psBackend: Backend<CodeSearchInputT, CodeSearchOutputT> = {
  id: 'powershell',

  async isCompatible(ctx) {
    // Only compatible on Windows
    if (ctx.platform !== 'win32') return false;
    try {
      const res = await ctx.runner.execFile(
        'powershell',
        ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.Major'],
        {
          timeoutMs: 1500,
        },
      );
      return res.exitCode === 0;
    } catch {
      return false;
    }
  },

  async run(input, ctx) {
    const cwd = input.cwd ?? ctx.repoRoot;
    const glob = input.glob ?? '*.*';

    // Build the PowerShell command using single-quote escaping for robustness
    // PowerShell escapes single quotes by doubling them: ' -> ''
    const safePattern = input.pattern.replace(/'/g, "''");
    const safeGlob = glob.replace(/'/g, "''");

    const matchMode = input.isRegex ? '' : '-SimpleMatch';

    // Using -LiteralPath for Get-ChildItem to avoid glob issues if not intended,
    // but here we actually want the glob for -Filter.
    // We use ,($_) to ensure ConvertTo-Json always outputs an array even for a single result.
    const command = `Get-ChildItem -Recurse -File -Filter '${safeGlob}' | Select-String -Pattern '${safePattern}' ${matchMode} | Select-Object Path, LineNumber, Line | ForEach-Object { ,$_ } | ConvertTo-Json -Compress`;

    const res = await ctx.runner.execFile('powershell', ['-NoProfile', '-Command', command], {
      cwd,
      timeoutMs: ctx.limits.timeoutMs,
      maxStdoutBytes: ctx.limits.maxOutputBytes,
    });

    if (res.timedOut) {
      return {
        ok: false,
        code: 'TIMEOUT',
        message: 'powershell execution timed out',
        retryable: true,
      };
    }

    if (res.exitCode !== 0) {
      return {
        ok: false,
        code: 'NONZERO_EXIT',
        message: `powershell exited with code ${res.exitCode}: ${res.stderr}`,
        retryable: true,
      };
    }

    try {
      const { matches, truncated } = parsePlainMatches(res.stdout, {
        format: 'ps-json',
        maxMatches: input.maxMatches ?? LIMITS.defaultSearchMatches,
      });

      // Normalize paths to be relative to repoRoot
      const normalizedMatches = matches.map((m) => ({
        ...m,
        file: m.file.startsWith(ctx.repoRoot)
          ? m.file.substring(ctx.repoRoot.length).replace(/^[\\/]/, '')
          : m.file,
      }));

      return {
        ok: true,
        output: {
          matches: normalizedMatches,
          truncated,
          backend: 'powershell',
          stats: { hits: normalizedMatches.length },
        },
      };
    } catch (err: any) {
      return {
        ok: false,
        code: 'RUNTIME_ERROR',
        message: `Failed to parse powershell output: ${err.message}`,
        retryable: true,
      };
    }
  },
};
