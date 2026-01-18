import { spawn } from 'child_process';

export class GitOperations {
  static async applyPatch(patch: string): Promise<{ success: boolean; error?: string }> {
    return new Promise((resolve) => {
      const child = spawn('git', ['apply', '--3way'], {
        stdio: ['pipe', 'pipe', 'pipe']
      });

      child.stdin.write(patch);
      child.stdin.end();

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        if (code === 0) {
          resolve({ success: true });
        } else {
          resolve({ 
            success: false, 
            error: `git apply failed with code ${code}: ${stderr || stdout}` 
          });
        }
      });
    });
  }

  static async rollbackFiles(files: string[]): Promise<void> {
    for (const file of files) {
      await this.rollbackFile(file);
    }
  }

  private static async rollbackFile(file: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn('git', ['checkout', '--', file]);

      child.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Failed to rollback file ${file}`));
        }
      });
    });
  }

  static async getModifiedFiles(): Promise<string[]> {
    return new Promise((resolve, reject) => {
      const child = spawn('git', ['diff', '--name-only'], {
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let output = '';
      child.stdout.on('data', (data) => {
        output += data.toString();
      });

      child.on('close', (code) => {
        if (code === 0) {
          const files = output.trim().split('\n').filter(f => f.trim());
          resolve(files);
        } else {
          reject(new Error('Failed to get modified files'));
        }
      });
    });
  }
}