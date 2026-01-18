import fs from 'fs/promises';
import { spawn } from 'child_process';

export async function applyPatch(repoPath: string, diffText: string): Promise<void> {
  const tempFile = `${repoPath}/.salmon_temp.patch`;
  await fs.writeFile(tempFile, diffText);
  
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['apply', '--3way', tempFile], { cwd: repoPath });
    
    let stderr = '';
    child.stderr.on('data', (data) => stderr += data.toString());
    
    child.on('close', async (code) => {
      try {
        await fs.unlink(tempFile);
      } catch {
        // 忽略删除错误
      }
      
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`git apply failed: ${stderr.trim()}`));
      }
    });
  });
}

export async function rollbackFiles(repoPath: string, files: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['checkout', '--', ...files], { cwd: repoPath });
    
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Rollback failed for files: ${files.join(', ')}`));
      }
    });
  });
}

export async function getGitDiff(repoPath: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    const child = spawn('git', ['diff'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: repoPath
    });

    let output = '';
    child.stdout.on('data', (data) => {
      output += data.toString();
    });

    child.on('close', (code) => {
      if (code === 0 && output.trim()) {
        resolve(output);
      } else {
        resolve(undefined);
      }
    });
  });
}