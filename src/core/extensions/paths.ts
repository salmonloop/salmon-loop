import os from 'node:os';
import path from 'node:path';

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
