import { spawn } from 'child_process';
import { LIMITS } from './limits.js';

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