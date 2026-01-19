import { spawn } from 'child_process';
import { LIMITS } from './limits.js';
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
    lowerOutput.includes('cannot find module')
  ) {
    return ErrorType.COMPILATION;
  }

  // Lint error keywords (Strong signals)
  if (
    (lowerOutput.includes('eslint') || lowerOutput.includes('prettier') || lowerOutput.includes('stylelint')) &&
    (lowerOutput.includes('error') || lowerOutput.includes('warning') || lowerOutput.includes('lint'))
  ) {
    return ErrorType.LINT;
  }

  // Test error keywords (Strong signals)
  if (
    lowerOutput.includes('fail') && (lowerOutput.includes('test suites') || lowerOutput.includes('test files')) || // Jest/Vitest
    lowerOutput.includes('assertionerror') ||
    lowerOutput.includes('expect(') ||
    lowerOutput.includes('failing') && lowerOutput.includes('mocha') ||
    /^E\s+.*$/m.test(output) // Pytest error marker
  ) {
    return ErrorType.TEST;
  }

  // Logic errors usually manifest as verification failure without obvious compilation/test framework errors
  if (output.trim().length > 0) {
    return ErrorType.LOGIC;
  }

  return ErrorType.UNKNOWN;
}

export async function runVerify(repoPath: string, verifyCommand: string): Promise<{
  ok: boolean;
  output: string;
  exitCode: number | null;
}> {
  return new Promise((resolve) => {
    const child = spawn(verifyCommand, {
      shell: true,
      cwd: repoPath,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });

    let output = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      output += '\n[Error] Verification timed out and was terminated.';
    }, LIMITS.verifyTimeoutMs);

    child.stdout?.on('data', (data) => {
      if (output.length < 200000) output += data.toString();
    });
    child.stderr?.on('data', (data) => {
      if (output.length < 200000) output += data.toString();
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({
        ok: false,
        output: `Failed to start verification: ${String(err)}`,
        exitCode: -1
      });
    });

    child.on('close', (exitCode) => {
      clearTimeout(timer);
      const fullOutput = output.trim();
      // Truncate to keep the LAST N lines as they usually contain the error details
      const lines = fullOutput.split('\n');
      const truncatedOutput = lines.length > LIMITS.verifyOutputMaxLines
        ? `...[Output truncated, showing last ${LIMITS.verifyOutputMaxLines} lines]...\n` +
          lines.slice(-LIMITS.verifyOutputMaxLines).join('\n')
        : fullOutput;
      
      resolve({
        ok: exitCode === 0,
        output: truncatedOutput,
        exitCode: exitCode
      });
    });
  });
}

export async function preflight(repoPath: string): Promise<{ ok: boolean; reason?: string }> {
  return new Promise((resolve) => {
    // 1. Check if it's a git repo
    const gitCheck = spawn('git', ['rev-parse', '--is-inside-work-tree'], { cwd: repoPath });
    
    gitCheck.on('error', () => {
      resolve({ ok: false, reason: 'GIT_NOT_FOUND' });
    });

    gitCheck.on('close', (code) => {
      if (code !== 0) {
        resolve({ ok: false, reason: 'NOT_A_GIT_REPO' });
        return;
      }

      // 2. Check if workspace is dirty
      const statusCheck = spawn('git', ['status', '--porcelain'], { cwd: repoPath });
      let output = '';
      
      statusCheck.on('error', () => {
        resolve({ ok: false, reason: 'GIT_NOT_FOUND' });
      });

      statusCheck.stdout.on('data', (data) => output += data.toString());
      statusCheck.on('close', (code) => {
        if (code === 0 && output.trim().length > 0) {
          resolve({ ok: false, reason: 'DIRTY_WORKSPACE' });
        } else {
          resolve({ ok: true });
        }
      });
    });
  });
}