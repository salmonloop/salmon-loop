import { execa } from 'execa';

import { ExecOpts, ExecResult } from './types.js';

/**
 * Creates a standard controlled runner for tool execution.
 * This encapsulates the process execution logic (execa) and
 * normalizes the output for backends.
 */
export function createControlledRunner() {
  return {
    execFile: async (file: string, args: string[], opts?: ExecOpts): Promise<ExecResult> => {
      try {
        const result = await execa(file, args, {
          cwd: opts?.cwd,
          timeout: opts?.timeoutMs,
          maxBuffer: opts?.maxStdoutBytes,
          env: opts?.env,
          reject: false, // Backends should handle exit codes themselves
        });

        return {
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: result.exitCode ?? 0,
          timedOut: result.timedOut,
        };
      } catch (err: unknown) {
        let stderr = String(err);
        let exitCode = -1;
        let timedOut = false;

        if (err instanceof Error) {
          stderr = err.message;
        }

        if (err && typeof err === 'object') {
          if ('exitCode' in err && typeof (err as { exitCode: unknown }).exitCode === 'number') {
            exitCode = (err as { exitCode: number }).exitCode;
          }
          if ('timedOut' in err && typeof (err as { timedOut: unknown }).timedOut === 'boolean') {
            timedOut = (err as { timedOut: boolean }).timedOut;
          }
        }

        return {
          stdout: '',
          stderr,
          exitCode,
          timedOut,
        };
      }
    },
  };
}
