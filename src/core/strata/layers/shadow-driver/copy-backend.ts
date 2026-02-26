/**
 * Copy Backend for ShadowDriver
 *
 * Platform-specific copy implementations:
 * - macOS: cp -Rc (APFS CoW)
 * - Linux: cp -r (safe) or cp -al (hardlink with readonly lock)
 * - Windows: robocopy /MIR
 */

import { logger } from '../../../observability/logger.js';
import { spawnCommand } from '../../../runtime/process-runner.js';
import { normalizePath } from '../../../utils/path.js';
import type { Platform } from '../../types.js';

/**
 * Copy directory with platform-specific implementation
 */
export async function copyDir(src: string, dest: string, platform: Platform): Promise<void> {
  const normalizedSrc = normalizePath(src);
  const normalizedDest = normalizePath(dest);

  logger.debug(`Copying ${normalizedSrc} to ${normalizedDest} on ${platform}`);

  if (platform === 'darwin') {
    try {
      await exec(['cp', '-Rc', `${normalizedSrc}/.`, normalizedDest], {
        allowExitCodes: new Set([0]),
      });
    } catch (err) {
      logger.warn(`macOS CoW copy failed, falling back to standard copy: ${err}`);
      await exec(['cp', '-R', `${normalizedSrc}/.`, normalizedDest], {
        allowExitCodes: new Set([0]),
      });
    }
    return;
  }

  if (platform === 'linux') {
    await exec(['cp', '-r', `${normalizedSrc}/.`, normalizedDest], {
      allowExitCodes: new Set([0]),
    });
    return;
  }

  if (platform === 'win32') {
    const robocopyArgs = [
      'robocopy',
      normalizedSrc,
      normalizedDest,
      '/MIR',
      '/MT:8',
      '/R:3',
      '/W:1',
      '/XD',
      '.git',
    ];
    // Robocopy exit codes 0-7 are considered success (e.g. 1 means files copied).
    // https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/robocopy
    await exec(robocopyArgs, {
      allowExitCodes: new Set([0, 1, 2, 3, 4, 5, 6, 7]),
    });
    return;
  }
}

/**
 * Hardlink directory (Linux only)
 */
export async function linkDirLinux(src: string, dest: string): Promise<void> {
  const normalizedSrc = normalizePath(src);
  const normalizedDest = normalizePath(dest);

  try {
    await exec(['cp', '-al', `${normalizedSrc}/.`, normalizedDest], {
      allowExitCodes: new Set([0]),
    });
  } catch (err: unknown) {
    if (String((err instanceof Error ? err.message : String(err)) || '').includes('EXDEV')) {
      logger.debug('Cross-device hardlink failed, falling back to copy');
      await exec(['cp', '-r', `${normalizedSrc}/.`, normalizedDest], {
        allowExitCodes: new Set([0]),
      });
      return;
    }
    throw err;
  }
}

/**
 * Execute command with timeout and error handling
 */
async function exec(
  command: string | string[],
  options: {
    timeout?: number;
    cwd?: string;
    allowExitCodes?: Set<number>;
  } = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  const commandArray = Array.isArray(command) ? command : [command];
  const allowExitCodes = options.allowExitCodes ?? new Set([0]);
  const timeout = options.timeout || 300000;

  let stdout = '';
  let stderr = '';
  const result = await spawnCommand({
    command: commandArray[0],
    args: commandArray.slice(1),
    cwd: options.cwd,
    timeoutMs: timeout,
    onStdoutChunk: (data) => {
      stdout += Buffer.from(data).toString();
    },
    onStderrChunk: (data) => {
      stderr += Buffer.from(data).toString();
    },
  });

  if (result.error) {
    throw new Error(`Command failed: ${result.error.message}`);
  }
  if (result.timedOut) {
    throw new Error(`Command timed out after ${timeout}ms`);
  }

  const exitCode = result.code ?? 0;
  if (allowExitCodes.has(exitCode)) {
    return { code: exitCode, stdout, stderr };
  }

  throw new Error(`Command failed with code ${exitCode}: ${stderr}`);
}
