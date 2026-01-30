import { logger } from '../../../logger';
import { runWithFallback } from '../../capability/executor';
import { CapabilityCtx } from '../../capability/types';
import { ToolRuntimeCtx, ExecutionPhase } from '../../types';

import { psBackend } from './backends/powershell';
import { rgBackend } from './backends/rg';
import { CodeSearchInputT, CodeSearchOutputT } from './spec';

/**
 * The main executor for code.search.
 * It transforms the general ToolRuntimeCtx into a specialized CapabilityCtx
 * and executes with backend fallback logic.
 */
export async function codeSearchExecutor(
  input: CodeSearchInputT,
  ctx: ToolRuntimeCtx & { phase: ExecutionPhase }, // Phase is injected by Router
): Promise<CodeSearchOutputT> {
  logger.debug(`Searching for pattern: ${input.pattern}`);

  // Construct CapabilityCtx for the underlying backends
  const capCtx: CapabilityCtx = {
    repoRoot: ctx.repoRoot,
    worktreeRoot: ctx.worktreeRoot,
    phase: ctx.phase,
    attemptId: ctx.attemptId,
    dryRun: ctx.dryRun,
    // Allow tests (and callers) to override platform; default to host platform.
    platform: (ctx as any).platform ?? process.platform,
    runner: (ctx as any).runner ?? {
      execFile: async (file, args, opts) => {
        const { execFile } = await import('child_process');
        const { promisify } = await import('util');
        const execFileAsync = promisify(execFile);
        try {
          const { stdout, stderr } = await execFileAsync(file, args, {
            cwd: opts?.cwd ?? ctx.repoRoot,
            timeout: opts?.timeoutMs,
            maxBuffer: opts?.maxStdoutBytes,
            env: { ...process.env, ...opts?.env },
          });
          return { stdout, stderr, exitCode: 0, timedOut: false };
        } catch (err: any) {
          return {
            stdout: err.stdout ?? '',
            stderr: err.stderr ?? '',
            exitCode: err.code ?? 1,
            timedOut: err.killed && err.signal === 'SIGTERM',
          };
        }
      },
    },
    limits: {
      timeoutMs: 30000,
      maxOutputBytes: 1024 * 1024,
    },
    audit: {
      event: (e) => logger.audit('code.search.backend', e),
    },
  };

  const backends = capCtx.platform === 'win32' ? [rgBackend, psBackend] : [rgBackend];

  const { output, meta } = await runWithFallback(backends, input, capCtx, {
    fallbackOn: new Set(['UNAVAILABLE', 'TIMEOUT', 'RUNTIME_ERROR', 'NONZERO_EXIT']),
    maxBackendTries: backends.length,
  });

  return {
    ...output,
    backend: meta.chosenBackend ?? 'unknown',
  };
}
