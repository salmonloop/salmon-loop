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
      await exec(['cp', '-Rc', `${normalizedSrc}/.`, normalizedDest]);
    } catch (err) {
      logger.warn(`macOS CoW copy failed, falling back to standard copy: ${err}`);
      await exec(['cp', '-R', `${normalizedSrc}/.`, normalizedDest]);
    }
    return;
  }

  if (platform === 'linux') {
    await exec(['cp', '-r', `${normalizedSrc}/.`, normalizedDest]);
    return;
  }

  if (platform === 'win32') {
    // For Windows, use direct spawn via array arguments to prevent command injection
    const robocopyArgs = [
      normalizedSrc,
      normalizedDest,
      '/MIR',
      '/MT:8',
      '/R:3',
      '/W:1',
      '/XD',
      '.git',
    ];
    const result = await exec(['robocopy', ...robocopyArgs]);
    const code = result.code ?? 0;

    // robocopy exit codes: 0-7 = success, 8+ = errors
    // Note: Robocopy 1-7 are success/info, 8+ are actual failures
    if (code >= 8) {
      throw new Error(`robocopy failed with exit code: ${code}. stderr: ${result.stderr}`);
    }
    return;
  }

  throw new Error(`Unsupported platform: ${platform}`);
}

/**
 * Hardlink directory (Linux only)
 */
export async function linkDirLinux(src: string, dest: string): Promise<void> {
  const normalizedSrc = normalizePath(src);
  const normalizedDest = normalizePath(dest);

  try {
    await exec(['cp', '-al', `${normalizedSrc}/.`, normalizedDest]);
  } catch (err: any) {
    if (String(err?.message || '').includes('EXDEV')) {
      logger.debug('Cross-device hardlink failed, falling back to copy');
      await exec(['cp', '-r', `${normalizedSrc}/.`, normalizedDest]);
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
  options: { shell?: string | boolean; timeout?: number } = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const commandArray = Array.isArray(command) ? command : [command];
    const shellOption = options.shell !== undefined ? options.shell : false;

    const child = spawn(commandArray[0], commandArray.slice(1), {
      shell: shellOption,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('error', (err) => {
      reject(new Error(`Command failed: ${err.message}`));
    });

    child.on('close', (code) => {
      resolve({ code: code ?? 0, stdout, stderr });
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
