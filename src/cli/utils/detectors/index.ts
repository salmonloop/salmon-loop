import fs from 'fs';
import path from 'path';

export interface ProjectDetector {
  detect(repoPath: string): Promise<string | undefined>;
}

export class NodeDetector implements ProjectDetector {
  async detect(repoPath: string): Promise<string | undefined> {
    const packageJsonPath = path.join(repoPath, 'package.json');
    if (fs.existsSync(packageJsonPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
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
