/**
 * Environment Variable Injection for ShadowDriver
 *
 * Provides optimized environment variables for dependency caching
 * and performance optimization.
 */

import os from 'os';
import path from 'path';

/**
 * Get environment variable injection for optimized execution
 */
export function getEnvInjection(repoRoot?: string): NodeJS.ProcessEnv {
  const delimiter = path.delimiter;
  const env: NodeJS.ProcessEnv = { ...process.env };

  // Node.js: fallback dependency paths
  const nodePaths = [env.NODE_PATH || '', '/usr/lib/s8p/global_modules'];
  if (repoRoot) {
    nodePaths.push(path.join(repoRoot, 'node_modules'));
  }
  env.NODE_PATH = nodePaths.filter(Boolean).join(delimiter);

  // Rust
  env.RUSTC_WRAPPER = env.RUSTC_WRAPPER || 'sccache';

  // C/C++
  env.CCACHE_DIR = env.CCACHE_DIR || path.join(os.homedir(), '.ccache');

  // Go
  env.GOCACHE = env.GOCACHE || path.join(os.homedir(), '.cache', 'go-build');

  return env;
}
