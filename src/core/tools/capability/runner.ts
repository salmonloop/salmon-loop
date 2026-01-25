import { execa } from 'execa';

import { ExecOpts, ExecResult } from './types';

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
      } catch (err: any) {
        return {
          stdout: '',
          stderr: err.message,
          exitCode: err.exitCode ?? -1,
          timedOut: err.timedOut ?? false,
        };
      }
    },
  };
}
