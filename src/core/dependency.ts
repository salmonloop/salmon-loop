import { readFile } from 'fs/promises';
import { readFileSync } from 'fs';
import { safeJoin, safeDirname } from './path.js';
import { text } from '../locales/index.js';

/**
 * Simple dependency analyzer to find related files
 */
export async function findFileDependencies(filePath: string, repoPath: string): Promise<string[]> {
  try {
    const content = await readFile(safeJoin(repoPath, filePath), 'utf-8');
    const dependencies: string[] = [];

    // Match relative imports: import ... from './foo' or import ... from '../bar'
    const importPattern = /from\s+['"](\.\.?\/[^'"]+)['"]/g;
    let match;

    while ((match = importPattern.exec(content)) !== null) {
      let depPath = match[1];

      // Add extension if missing (simple heuristic for TS/JS)
      if (!depPath.endsWith('.ts') && !depPath.endsWith('.js')) {
        depPath += '.ts'; // Default to .ts
      }

      const absoluteDepPath = safeJoin(safeDirname(filePath), depPath);
      dependencies.push(absoluteDepPath);
    }

    return dependencies;
  } catch {
    return [];
  }
}

/**
 * Check dependency versions against expected values
 */
export function checkDependencyVersions(rootPath: string): void {
  try {
    // Read package.json
    const packageJsonPath = safeJoin(rootPath, 'package.json');
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
    
    // Check web-tree-sitter version
    const expectedVersion = '0.26.3';
    const actualVersion = packageJson.dependencies?.['web-tree-sitter'];
    
    if (actualVersion !== expectedVersion) {
      console.warn(text.dependency.versionMismatch('web-tree-sitter', expectedVersion, actualVersion));
      console.warn(text.dependency.versionMismatchHint);
    }
  } catch (error) {
    console.error(text.dependency.checkFailed + ':', error);
  }
}