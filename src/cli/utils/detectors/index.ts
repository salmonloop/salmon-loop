import {
  detectNodeRuntimeProfile,
  resolveNodeVerifyCommand,
} from '../../../core/target-runtime/index.js';

export interface ProjectDetector {
  detect(repoPath: string): Promise<string | undefined>;
}

export class NodeDetector implements ProjectDetector {
  async detect(repoPath: string): Promise<string | undefined> {
    const profile = await detectNodeRuntimeProfile(repoPath);
    if (!profile) return undefined;
    return resolveNodeVerifyCommand(profile);
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
