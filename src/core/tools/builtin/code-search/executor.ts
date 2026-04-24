import { LIMITS } from '../../../config/limits.js';
import { getLogger } from '../../../observability/logger.js';
import { spawnCommand } from '../../../runtime/process-runner.js';
import { runWithFallback } from '../../capability/executor.js';
import { CapabilityCtx } from '../../capability/types.js';
import { ToolRuntimeCtx, ExecutionPhase } from '../../types.js';

import { psBackend } from './backends/powershell.js';
import { rgBackend } from './backends/rg.js';
import { CodeSearchInputT, CodeSearchOutputT, resolveCodeSearchCwd } from './spec.js';

/**
 * The main executor for code.search.
 * It transforms the general ToolRuntimeCtx into a specialized CapabilityCtx
 * and executes with backend fallback logic.
 */
export async function codeSearchExecutor(
  input: CodeSearchInputT,
  ctx: ToolRuntimeCtx & { phase: ExecutionPhase }, // Phase is injected by Router
): Promise<CodeSearchOutputT> {
  getLogger().debug(`Searching for pattern: ${input.pattern}`);
  const normalizedInput: CodeSearchInputT = {
    ...input,
    cwd: resolveCodeSearchCwd(ctx.repoRoot, input.cwd),
  };

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
        const maxStdoutBytes = opts?.maxStdoutBytes ?? Number.POSITIVE_INFINITY;
        let stdout = '';
        let stderr = '';
        let stdoutBytes = 0;

        const result = await spawnCommand({
          command: file,
          args,
          cwd: opts?.cwd ?? ctx.repoRoot,
          timeoutMs: opts?.timeoutMs,
          signal: ctx.signal,
          env: { ...process.env, ...ctx.env, ...opts?.env },
          onStdoutChunk: (chunk) => {
            if (stdoutBytes >= maxStdoutBytes) return;
            const buffer = Buffer.from(chunk);
            const remaining = maxStdoutBytes - stdoutBytes;
            if (buffer.length <= remaining) {
              stdout += buffer.toString();
              stdoutBytes += buffer.length;
              return;
            }
            stdout += buffer.subarray(0, remaining).toString();
            stdoutBytes += remaining;
          },
          onStderrChunk: (chunk) => {
            stderr += Buffer.from(chunk).toString();
          },
        });

        if (result.error) {
          return {
            stdout,
            stderr: stderr || result.error.message,
            exitCode: 1,
            timedOut: false,
          };
        }

        return {
          stdout,
          stderr,
          exitCode: result.code ?? 1,
          timedOut: result.timedOut,
        };
      },
    },
    limits: {
      timeoutMs: LIMITS.defaultToolTimeoutMs,
      maxOutputBytes: LIMITS.maxToolOutputBytes,
    },
    audit: {
      event: (e) =>
        getLogger().audit('code.search.backend', e, { source: 'tool', severity: 'low' }),
    },
  };

  const backends = capCtx.platform === 'win32' ? [rgBackend, psBackend] : [rgBackend];

  const { output, meta } = await runWithFallback(backends, normalizedInput, capCtx, {
    fallbackOn: new Set(['UNAVAILABLE', 'TIMEOUT', 'RUNTIME_ERROR', 'NONZERO_EXIT']),
    maxBackendTries: backends.length,
  });

  return {
    ...output,
    backend: meta.chosenBackend ?? 'unknown',
  };
}
