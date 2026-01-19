import { readFile } from 'fs/promises';
import { join, dirname } from 'path';

/**
 * Simple dependency analyzer to find related files
 */
export async function findFileDependencies(filePath: string, repoPath: string): Promise<string[]> {
  try {
    const content = await readFile(join(repoPath, filePath), 'utf-8');
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

      const absoluteDepPath = join(dirname(filePath), depPath);
      dependencies.push(absoluteDepPath.replace(/\\/g, '/'));
    }

    return dependencies;
  } catch {
    return [];
  }
}
