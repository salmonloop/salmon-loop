/**
 * Copy Backend for ShadowDriver
 *
 * Platform-specific copy implementations:
 * - macOS: cp -Rc (APFS CoW)
 * - Linux: cp -r (safe) or cp -al (hardlink with readonly lock)
 * - Windows: robocopy /MIR
 */

import { spawn } from 'child_process';

import { logger } from '../../../logger.js';
import { normalizePath } from '../../../path.js';
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
  } catch (err: any) {
    if (String(err?.message || '').includes('EXDEV')) {
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
    shell?: string | boolean;
    timeout?: number;
    cwd?: string;
    allowExitCodes?: Set<number>;
  } = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const commandArray = Array.isArray(command) ? command : [command];
    const shellOption = options.shell !== undefined ? options.shell : false;
    const allowExitCodes = options.allowExitCodes ?? new Set([0]);

    const child = spawn(commandArray[0], commandArray.slice(1), {
      shell: shellOption,
      cwd: options.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    child.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    child.on('error', (err: Error) => {
      reject(new Error(`Command failed: ${err.message}`));
    });

    child.on('close', (code: number | null) => {
      const exitCode = code ?? 0;
      if (allowExitCodes.has(exitCode)) {
        resolve({ code: exitCode, stdout, stderr });
        return;
      }
      reject(new Error(`Command failed with code ${exitCode}: ${stderr}`));
    });

    // Set timeout
    const timeout = options.timeout || 300000; // 5 minutes default for large dependencies
    setTimeout(() => {
      if (!child.killed) {
        child.kill();
        reject(new Error(`Command timed out after ${timeout}ms`));
      }
    }, timeout);
  });
}
