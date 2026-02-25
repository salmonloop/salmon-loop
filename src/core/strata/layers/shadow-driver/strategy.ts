/**
 * Strategy Selector for ShadowDriver
 *
 * Implements the strategy determination logic:
 * - Default: ISOLATED (safe by default)
 * - Whitelist: OPTIMIZED (fast if possible)
 * - Blacklist: ISOLATED (fallback on failure)
 */

import { join } from 'path';

import { existsSync } from '../../../adapters/fs/node-fs.js';
import type { ShadowTask, Strategy } from '../../types.js';
import { WRITE_OP_BLACKLIST } from '../../types.js';

/**
 * Normalize command for consistent matching
 */
function normalizeCommand(cmd: string): string {
  return cmd.trim().replace(/\\/g, '/').toLowerCase();
}

/**
 * Determine the appropriate strategy for a given task
 */
export function determineStrategy(task: ShadowTask, whitelist?: string[]): Strategy {
  // Force isolation takes precedence
  if (task.forceIsolation || task.requiresWrite) return 'ISOLATED';

  const normalizedCmd = normalizeCommand(task.command);

  // Whitelist check
  if (whitelist && whitelist.length > 0) {
    const inWhitelist = whitelist.some((safeCmd) =>
      normalizedCmd.startsWith(normalizeCommand(safeCmd)),
    );
    if (!inWhitelist) return 'ISOLATED';
  }

  // Blacklist check
  if (WRITE_OP_BLACKLIST.some((op) => normalizedCmd.includes(op))) return 'ISOLATED';

  // Mode-based optimization
  if (task.mode === 'analysis' || task.mode === 'test_readonly') return 'OPTIMIZED';

  // Default to isolation
  return 'ISOLATED';
}

/**
 * Plan dependency paths based on repository configuration
 */
export async function planDependencyPaths(config: {
  repoRoot: string;
  dependencyPaths: string[];
}): Promise<string[]> {
  if (config.dependencyPaths?.length) {
    return config.dependencyPaths.filter((p) => validateDependencyPath(config.repoRoot, p));
  }
  return detectDependencyPaths(config.repoRoot);
}

/**
 * Validate dependency path for security
 */
export function validateDependencyPath(repoRoot: string, depPath: string): boolean {
  if (depPath.startsWith('/') || /^[a-zA-Z]:/.test(depPath)) return false;
  if (depPath.includes('..')) return false;
  return true;
}

/**
 * Detect dependency paths based on repository files
 */
export async function detectDependencyPaths(repoRoot: string): Promise<string[]> {
  const paths: string[] = [];

  // Node.js
  if (existsSync(join(repoRoot, 'package.json'))) {
    paths.push('node_modules');
  }

  // Python
  if (
    existsSync(join(repoRoot, 'requirements.txt')) ||
    existsSync(join(repoRoot, 'pyproject.toml'))
  ) {
    paths.push('venv');
    paths.push('.venv');
    paths.push('__pycache__');
  }

  // Rust
  if (existsSync(join(repoRoot, 'Cargo.toml'))) {
    paths.push('target');
  }

  // Go
  if (existsSync(join(repoRoot, 'go.mod'))) {
    paths.push('vendor');
  }

  return paths.filter((p) => existsSync(join(repoRoot, p)));
}
