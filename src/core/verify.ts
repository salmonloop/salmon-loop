import { spawn } from 'child_process';
import { readFile } from 'fs/promises';
import { join } from 'path';

import { text } from '../locales/index.js';

import { LIMITS } from './limits.js';
import { logger } from './logger.js';
import { ErrorType } from './types.js';

export function classifyError(output: string): ErrorType {
  const lowerOutput = output.toLowerCase();

  // Compilation error keywords (Strong signals)
  if (
    /\bTS\d{3,5}\b/.test(output) || // TypeScript error codes
    lowerOutput.includes('compilation error') ||
    lowerOutput.includes('failed to compile') ||
    lowerOutput.includes('syntaxerror') ||
    lowerOutput.includes('type error') ||
    lowerOutput.includes('cannot find module') ||
    lowerOutput.includes('module not found') ||
    /error:.*is not a member of/i.test(output) || // C++/Java style
    /undefined reference to/i.test(output) // Linker error
  ) {
    return ErrorType.COMPILATION;
  }

  // Lint error keywords (Strong signals)
  if (
    lowerOutput.includes('eslint') ||
    lowerOutput.includes('prettier') ||
    lowerOutput.includes('stylelint') ||
    lowerOutput.includes('lint') ||
    lowerOutput.includes('checkstyle')
  ) {
    // If it's a lint tool, and it's not a compilation error, it's likely a lint error
    return ErrorType.LINT;
  }

  // Test error keywords (Strong signals)
  if (
    ((lowerOutput.includes('fail') || lowerOutput.includes('failed')) &&
      (lowerOutput.includes('test suites') ||
        lowerOutput.includes('test files') ||
        lowerOutput.includes('spec'))) || // Jest/Vitest/Mocha
    lowerOutput.includes('assertionerror') ||
    lowerOutput.includes('expect(') ||
    lowerOutput.includes('should(') ||
    (lowerOutput.includes('failing') && lowerOutput.includes('mocha')) ||
    /^E\s+.*$/m.test(output) || // Pytest error marker
    /FAILED \(failures=\d+\)/.test(output) // Python unittest
  ) {
    return ErrorType.TEST;
  }

  // Logic errors usually manifest as verification failure without obvious compilation/test framework errors
  if (output.trim().length > 0) {
    return ErrorType.LOGIC;
  }

  return ErrorType.UNKNOWN;
}

export async function runVerify(
  repoPath: string,
  verifyCommand: string,
): Promise<{
  ok: boolean;
  output: string;
  exitCode: number | null;
}> {
  return new Promise((resolve) => {
    const child = spawn(verifyCommand, {
      shell: true,
      cwd: repoPath,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    let output = '';
    let isTerminated = false;

    const timer = setTimeout(() => {
      isTerminated = true;
      // Try graceful termination first
      child.kill('SIGTERM');

      // Force kill after a short delay if still running
      setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch (__e) {
          // Ignore
        }
      }, 2000);

      output += '\n[Error] Verification timed out and was terminated.';
    }, LIMITS.verifyTimeoutMs);

    child.stdout?.on('data', (data) => {
      if (output.length < 500000) output += data.toString();
    });
    child.stderr?.on('data', (data) => {
      if (output.length < 500000) output += data.toString();
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({
        ok: false,
        output: `Failed to start verification command "${verifyCommand}": ${String(err)}. Please check if the command is valid and you have necessary permissions.`,
        exitCode: -1,
      });
    });

    child.on('close', (exitCode) => {
      clearTimeout(timer);
      const fullOutput = output.trim();
      const lines = fullOutput.split('\n');

      let truncatedOutput = fullOutput;
      if (lines.length > LIMITS.verifyOutputMaxLines) {
        const half = Math.floor(LIMITS.verifyOutputMaxLines / 2);
        const head = lines.slice(0, half).join('\n');
        const tail = lines.slice(-half).join('\n');
        truncatedOutput = `${head}\n\n...[Output truncated, showing first and last ${half} lines]...\n\n${tail}`;
      }

      resolve({
        ok: !isTerminated && exitCode === 0,
        output: truncatedOutput,
        exitCode: exitCode,
      });
    });
  });
}

/**
 * Verify if a file contains the expected content (string or regex).
 *
 * @param repoPath - The root path of the repository
 * @param filePath - The relative path of the file to check
 * @param expected - The content string or regex to look for
 * @returns true if the content is found, false otherwise (including if file is missing)
 */
export async function verifyFileContent(
  repoPath: string,
  filePath: string,
  expected: string | RegExp,
): Promise<boolean> {
  try {
    const fullPath = join(repoPath, filePath);
    const content = await readFile(fullPath, 'utf-8');

    if (typeof expected === 'string') {
      return content.includes(expected);
    } else {
      return expected.test(content);
    }
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      return false;
    }
    // Log unexpected errors for transparency, but return false as verification failed
    logger.warn(`verifyFileContent error for ${filePath}: ${err.message}`);
    return false;
  }
}

export async function preflight(repoPath: string): Promise<{ ok: boolean; reason?: string }> {
  return new Promise((resolve) => {
    // 1. Check if it's a git repo
    const gitCheck = spawn('git', ['rev-parse', '--is-inside-work-tree'], { cwd: repoPath });

    gitCheck.on('error', (err: any) => {
      if (err.code === 'ENOENT') {
        resolve({ ok: false, reason: text.loop.gitNotFound });
      } else {
        resolve({ ok: false, reason: `Git check failed: ${err.message}` });
      }
    });

    gitCheck.on('close', (code) => {
      if (code !== 0) {
        resolve({ ok: false, reason: text.loop.preflightFailedNotGit });
        return;
      }

      // 2. Check if workspace is dirty
      const statusCheck = spawn('git', ['status', '--porcelain'], { cwd: repoPath });
      let output = '';

      statusCheck.on('error', (err) => {
        resolve({ ok: false, reason: `Git status check failed: ${err.message}` });
      });

      statusCheck.stdout.on('data', (data) => (output += data.toString()));
      statusCheck.on('close', (code) => {
        if (code === 0 && output.trim().length > 0) {
          resolve({ ok: false, reason: text.loop.preflightFailedDirty(output.trim()) });
        } else {
          resolve({ ok: true });
        }
      });
    });

    // 3. Check if ripgrep is installed (optional but recommended)
    const rgCheck = spawn('rg', ['--version']);
    rgCheck.on('error', (err: any) => {
      if (err.code === 'ENOENT') {
        logger.warn(
          'Warning: ripgrep (rg) not found in PATH. Automatic context gathering will be disabled. Please use --file to specify target files or install ripgrep.',
        );
      }
    });
  });
}
