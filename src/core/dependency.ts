import { readFileSync } from 'fs';
import { readFile } from 'fs/promises';

import { text } from '../locales/index.js';

import { LIMITS } from './limits.js';
import { logger } from './logger.js';
import { safeJoin, safeDirname } from './path.js';
import { pluginRegistry } from './plugin/registry.js';

/**
 * Simple dependency analyzer to find related files
 */
export async function findFileDependencies(
  filePath: string,
  repoPath: string,
  options?: { depth?: number; maxFiles?: number },
): Promise<string[]> {
  const depth = Math.max(1, Math.min(LIMITS.maxDependencyDepth, options?.depth ?? 1));
  const maxFiles = Math.max(1, options?.maxFiles ?? 1000);

  const results: string[] = [];
  const seen = new Set<string>();
  let frontier: string[] = [filePath];

  // Pre-load plugins if not already loaded (though they should be by preflight)
  // For safety in unit tests that might skip preflight:
  // await PluginLoader.loadPlugins(); // Ideally this is done at app start

  for (let d = 0; d < depth; d++) {
    const nextFrontier: string[] = [];

    for (const current of frontier) {
      if (results.length >= maxFiles) return results;

      const deps = await findDirectDependencies(current, repoPath);
      for (const dep of deps) {
        if (results.length >= maxFiles) break;
        if (seen.has(dep)) continue;
        seen.add(dep);
        results.push(dep);
        nextFrontier.push(dep);
      }
    }

    frontier = nextFrontier;
    if (frontier.length === 0) break;
  }

  return results;
}

async function findDirectDependencies(filePath: string, repoPath: string): Promise<string[]> {
  try {
    const content = await readFile(safeJoin(repoPath, filePath), 'utf-8');
    const dependencies: string[] = [];

    // Detect language plugin for this file
    const plugin = pluginRegistry.getByExtension(filePath);

    if (plugin) {
      // Use plugin strategy
      const rawImports = plugin.dependency.extractImports(content);

      for (const rawImport of rawImports) {
        // Resolve path
        let resolvedDep = rawImport;
        if (plugin.dependency.resolvePath) {
          const result = plugin.dependency.resolvePath(safeDirname(filePath), rawImport);
          if (result) {
            resolvedDep = result;
          }
        } else {
          // Default fallback resolution if plugin doesn't specify
          // (This might need improvement for generic support)
          resolvedDep = rawImport;
        }

        // Construct absolute path
        // Assumptions: rawImport is relative.
        // If plugin handles resolution fully, we might need to adjust.
        // For now, assuming plugin.resolvePath returns a relative path with extension

        const absoluteDepPath = safeJoin(safeDirname(filePath), resolvedDep);
        dependencies.push(absoluteDepPath);
      }
    } else {
      // Fallback for unknown languages? Or just return empty.
      // For now, empty.
    }

    return dependencies;
  } catch {
    return [];
  }
}

/**
 * Check dependency versions against expected values
 */
export function verifyDependencyVersion(rootPath: string): void {
  try {
    // Read package.json
    const packageJsonPath = safeJoin(rootPath, 'package.json');
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));

    // Check web-tree-sitter version
    const expectedVersion = '0.26.3';
    const actualVersion = packageJson.dependencies?.['web-tree-sitter'];

    if (actualVersion !== expectedVersion) {
      logger.warn(
        text.dependency.versionMismatch('web-tree-sitter', expectedVersion, actualVersion),
      );
      logger.warn(text.dependency.versionMismatchHint);
    }
  } catch (error) {
    logger.error(`${text.dependency.checkFailed}: ${error}`);
  }
}
