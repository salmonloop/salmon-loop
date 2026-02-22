import { existsSync, readFileUtf8Sync, safePathJoin } from '../safe-fs.js';

export interface ProjectDetector {
  detect(repoPath: string): Promise<string | undefined>;
}

export class NodeDetector implements ProjectDetector {
  async detect(repoPath: string): Promise<string | undefined> {
    const packageJsonPath = safePathJoin(repoPath, 'package.json');
    if (existsSync(packageJsonPath, repoPath)) {
      try {
        const pkg = JSON.parse(readFileUtf8Sync(packageJsonPath, repoPath));
        if (pkg.scripts && pkg.scripts.test) {
          const bunLockPath = safePathJoin(repoPath, 'bun.lock');
          const bunLockbPath = safePathJoin(repoPath, 'bun.lockb');
          const packageManager = typeof pkg.packageManager === 'string' ? pkg.packageManager : '';

          if (
            packageManager.startsWith('bun@') ||
            existsSync(bunLockPath, repoPath) ||
            existsSync(bunLockbPath, repoPath)
          ) {
            return 'bun run test';
          }

          return 'bun run test';
        }
      } catch (_error) {
        // Ignore JSON parse errors
      }
    }
    return undefined;
  }
}

export const detectors: ProjectDetector[] = [new NodeDetector()];

export async function autoDetectVerifyCommand(repoPath: string): Promise<string | undefined> {
  for (const detector of detectors) {
    const command = await detector.detect(repoPath);
    if (command) {
      return command;
    }
  }
  return undefined;
}
