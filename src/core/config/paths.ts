import { join, resolve } from 'path';

/**
 * Repo-local configuration lives under ".salmonloop/" and is expected to be gitignored.
 * This directory is separate from ".s8p/" which stores runtime state (audit/checkpoints/etc.).
 */
export function getDefaultRepoConfigPath(repoRoot: string): string {
  return join(resolve(repoRoot), '.salmonloop', 'config', 'config.json');
}

export function resolveConfigPath(repoRoot: string, configPath: string): string {
  // Relative paths are resolved against the target repo root (not the CLI's cwd).
  return resolve(repoRoot, configPath);
}
