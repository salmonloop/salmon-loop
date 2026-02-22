import { existsSync } from 'fs';
import { readFile } from 'fs/promises';

import { ensureInSandbox, safeJoin } from '../utils/path.js';

export type NodePackageManager = 'bun' | 'npm' | 'pnpm' | 'yarn';
export type RuntimeDetectionSource = 'packageManager' | 'lockfile' | 'default';

export interface NodeRuntimeProfile {
  packageManager: NodePackageManager;
  source: RuntimeDetectionSource;
  scripts: Record<string, string>;
}

const LOCKFILE_HINTS: Array<{ file: string; manager: NodePackageManager }> = [
  { file: 'bun.lock', manager: 'bun' },
  { file: 'bun.lockb', manager: 'bun' },
  { file: 'pnpm-lock.yaml', manager: 'pnpm' },
  { file: 'yarn.lock', manager: 'yarn' },
  { file: 'package-lock.json', manager: 'npm' },
  { file: 'npm-shrinkwrap.json', manager: 'npm' },
];

function safeRepoPath(repoPath: string, relativePath: string): string {
  const joined = safeJoin(repoPath, relativePath);
  return ensureInSandbox(repoPath, joined);
}

function parsePackageManagerField(value: unknown): NodePackageManager | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return undefined;
  const [name] = normalized.split('@');
  if (name === 'bun' || name === 'npm' || name === 'pnpm' || name === 'yarn') {
    return name;
  }
  return undefined;
}

function normalizeScripts(rawScripts: unknown): Record<string, string> {
  if (!rawScripts || typeof rawScripts !== 'object') return {};
  const scripts: Record<string, string> = {};
  for (const [name, command] of Object.entries(rawScripts as Record<string, unknown>)) {
    if (typeof command !== 'string') continue;
    const normalized = command.trim();
    if (!normalized) continue;
    scripts[name] = normalized;
  }
  return scripts;
}

function detectPackageManager(
  repoPath: string,
  pkg: Record<string, unknown>,
): {
  packageManager: NodePackageManager;
  source: RuntimeDetectionSource;
} {
  const packageManagerFromField = parsePackageManagerField(pkg.packageManager);
  if (packageManagerFromField) {
    return { packageManager: packageManagerFromField, source: 'packageManager' };
  }

  for (const hint of LOCKFILE_HINTS) {
    if (existsSync(safeRepoPath(repoPath, hint.file))) {
      return { packageManager: hint.manager, source: 'lockfile' };
    }
  }

  return { packageManager: 'npm', source: 'default' };
}

export async function detectNodeRuntimeProfile(
  repoPath: string,
): Promise<NodeRuntimeProfile | undefined> {
  const packageJsonPath = safeRepoPath(repoPath, 'package.json');
  if (!existsSync(packageJsonPath)) return undefined;

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(await readFile(packageJsonPath, 'utf-8')) as Record<string, unknown>;
  } catch {
    return undefined;
  }

  const { packageManager, source } = detectPackageManager(repoPath, parsed);
  const scripts = normalizeScripts(parsed.scripts);

  return {
    packageManager,
    source,
    scripts,
  };
}
