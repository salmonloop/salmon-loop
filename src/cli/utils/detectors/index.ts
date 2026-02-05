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
          return 'npm test';
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
