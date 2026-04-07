import os from 'node:os';
import path from 'node:path';

import { realpathSync } from '../adapters/fs/node-fs.js';
import { tryGetLogger } from '../observability/logger.js';

export const REPO_CONFIG_DIR = '.salmonloop/config';
export const USER_CONFIG_DIR = path.join(os.homedir(), '.salmonloop', 'config');

export function expandHome(value: string): string {
  if (value.startsWith('~')) {
    return path.join(os.homedir(), value.slice(1));
  }
  return value;
}

export function resolveRepoRelative(repoRoot: string, relative: string): string {
  if (path.isAbsolute(relative)) return relative;
  return path.resolve(repoRoot, relative);
}

export function resolveUserRelative(relative: string): string {
  const expanded = expandHome(relative);
  if (path.isAbsolute(expanded)) return expanded;
  return path.resolve(USER_CONFIG_DIR, relative);
}

export function getRepoMcpConfigPath(repoRoot: string): string {
  return path.join(repoRoot, REPO_CONFIG_DIR, 'mcp.json');
}

export function getRepoToolConfigPath(repoRoot: string): string {
  return path.join(repoRoot, REPO_CONFIG_DIR, 'tools.json');
}

export function getRepoSkillConfigPath(repoRoot: string): string {
  return path.join(repoRoot, REPO_CONFIG_DIR, 'skills.json');
}

export function getUserMcpConfigPath(): string {
  return path.join(USER_CONFIG_DIR, 'mcp-user.json');
}

export function getUserToolConfigPath(): string {
  return path.join(USER_CONFIG_DIR, 'tools-user.json');
}

export function getUserSkillConfigPath(): string {
  return path.join(USER_CONFIG_DIR, 'skills-user.json');
}

/**
 * Check whether a candidate path resides within (or equals) a given root directory.
 *
 * Uses realpath resolution to detect symlink-based escapes when both paths exist.
 * When the candidate does not yet exist on disk (e.g. configured before the
 * directory is created), falls back to a lexical containment check on the
 * resolved (but not realpath'd) path. This avoids silently discarding valid
 * future paths while still catching traversal attacks on existing paths.
 *
 * @returns true when the resolved candidate is the root itself or a descendant;
 *          false when the path escapes the root.
 */
export function isWithinRoot(candidate: string, root: string): boolean {
  const resolvedCandidate = path.resolve(candidate);
  const resolvedRoot = path.resolve(root);

  try {
    // Happy path: both exist — use realpath to resolve symlinks
    const realCandidate = realpathSync(resolvedCandidate);
    const realRoot = realpathSync(resolvedRoot);
    return realCandidate === realRoot || realCandidate.startsWith(realRoot + path.sep);
  } catch {
    // Candidate or root does not exist yet — fall back to lexical check.
    // This allows pre-declaring paths that will be created later, while
    // still catching obvious traversal sequences like `../../etc`.
    tryGetLogger()?.debug(
      `isWithinRoot: path not on disk, using lexical check for "${candidate}" against root "${root}"`,
    );
    return resolvedCandidate === resolvedRoot || resolvedCandidate.startsWith(resolvedRoot + path.sep);
  }
}
