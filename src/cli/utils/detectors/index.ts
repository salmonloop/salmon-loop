import {
  detectNodeRuntimeProfile,
  resolveNodeWorktreePrepareCommand,
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

export class NodeWorktreePrepareDetector implements ProjectDetector {
  async detect(repoPath: string): Promise<string | undefined> {
    const profile = await detectNodeRuntimeProfile(repoPath);
    if (!profile) return undefined;
    return resolveNodeWorktreePrepareCommand(profile);
  }
}

export const worktreePrepareDetectors: ProjectDetector[] = [new NodeWorktreePrepareDetector()];

export async function autoDetectVerifyCommand(repoPath: string): Promise<string | undefined> {
  for (const detector of detectors) {
    const command = await detector.detect(repoPath);
    if (command) {
      return command;
    }
  }
  return undefined;
}

export async function autoDetectWorktreePrepareCommand(
  repoPath: string,
): Promise<string | undefined> {
  for (const detector of worktreePrepareDetectors) {
    const command = await detector.detect(repoPath);
    if (command) {
      return command;
    }
  }
  return undefined;
}
