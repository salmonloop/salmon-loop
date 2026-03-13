import { homedir } from 'os';

import { defaultPathAdapter } from '../adapters/path/path-adapter.js';

/**
 * Repo-local configuration lives under ".salmonloop/" and is expected to be gitignored.
 * Runtime state is stored under ".salmonloop/runtime/" (audit, rejections, tmp, locks).
 */
export function getDefaultRepoConfigPath(repoRoot: string): string {
  return getDefaultRepoConfigPaths(repoRoot)[0];
}

export function getDefaultRepoConfigPaths(repoRoot: string): string[] {
  const base = defaultPathAdapter.join(
    defaultPathAdapter.resolve(repoRoot),
    '.salmonloop',
    'config',
  );
  return [
    defaultPathAdapter.join(base, 'config.yaml'),
    defaultPathAdapter.join(base, 'config.yml'),
    defaultPathAdapter.join(base, 'config.json'),
  ];
}

export function getDefaultUserConfigPaths(): string[] {
  const base = defaultPathAdapter.join(homedir(), '.salmonloop', 'config');
  return [
    defaultPathAdapter.join(base, 'config.yaml'),
    defaultPathAdapter.join(base, 'config.yml'),
    defaultPathAdapter.join(base, 'config.json'),
  ];
}

export function resolveConfigPath(repoRoot: string, configPath: string): string {
  // Relative paths are resolved against the target repo root (not the CLI's cwd).
  return defaultPathAdapter.resolve(repoRoot, configPath);
}

export function getDefaultIndexPath(repoRoot: string): string {
  return defaultPathAdapter.join(defaultPathAdapter.resolve(repoRoot), '.salmonloop', 'index');
}
