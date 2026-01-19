import { spawn } from 'child_process';
import { LIMITS } from './limits.js';
import { ErrorType } from './types.js';

export function classifyError(output: string): ErrorType {
  const lowerOutput = output.toLowerCase();
  
  // Compilation error keywords
  if (
    lowerOutput.includes('error ts') ||
    lowerOutput.includes('compilation error') ||
    lowerOutput.includes('failed to compile') ||
    lowerOutput.includes('syntaxerror')
  ) {
    return ErrorType.COMPILATION;
  }

  // Lint error keywords
  if (
    lowerOutput.includes('eslint') ||
    lowerOutput.includes('lint') ||
    lowerOutput.includes('prettier') ||
    lowerOutput.includes('no-unused-vars')
  ) {
    return ErrorType.LINT;
  }

  // Test error keywords
  if (
    lowerOutput.includes('test failed') ||
    lowerOutput.includes('expect(') ||
    lowerOutput.includes('assertionerror') ||
    lowerOutput.includes('failed') && (lowerOutput.includes('test') || lowerOutput.includes('spec'))
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
  exitCode: number;
}> {
  return new Promise((resolve) => {
    const child = spawn(verifyCommand, {
      shell: true,
      cwd: repoPath,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';
    
    child.stdout.on('data', (data) => stdout += data.toString());
    child.stderr.on('data', (data) => stderr += data.toString());

    child.on('close', (exitCode) => {
      const fullOutput = `${stdout}\n${stderr}`.trim();
      const truncatedOutput = fullOutput
        .split('\n')
        .slice(0, LIMITS.verifyOutputMaxLines)
        .join('\n');
      
      resolve({
        ok: exitCode === 0,
        output: truncatedOutput,
        exitCode: exitCode || 0
      });
    });
  });
}

export async function preflight(repoPath: string): Promise<{ ok: boolean; reason?: string }> {
  return new Promise((resolve) => {
    // 1. Check if it's a git repo
    const gitCheck = spawn('git', ['rev-parse', '--is-inside-work-tree'], { cwd: repoPath });
    gitCheck.on('close', (code) => {
      if (code !== 0) {
        resolve({ ok: false, reason: 'NOT_A_GIT_REPO' });
        return;
      }

      // 2. Check if workspace is dirty
      const statusCheck = spawn('git', ['status', '--porcelain'], { cwd: repoPath });
      let output = '';
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