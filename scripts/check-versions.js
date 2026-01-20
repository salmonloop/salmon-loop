import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Standalone script to check dependency versions before installation.
 * This script uses plain Node.js features to ensure it runs during preinstall.
 */

const rootPath = process.cwd();
const packageJsonPath = join(rootPath, 'package.json');

try {
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
  
  // Expected version for web-tree-sitter
  const expectedVersion = '0.26.3';
  const actualVersion = packageJson.dependencies?.['web-tree-sitter'];
  
  if (actualVersion && actualVersion !== expectedVersion) {
    console.warn(`⚠️  Dependency version mismatch: web-tree-sitter expected ${expectedVersion}, but got ${actualVersion}`);
    console.warn('   This may cause compatibility issues. Please update your package.json.');
  }
  
  console.log('✅ Dependency version check completed');
} catch (error) {
  // We don't want to block installation if package.json is missing or invalid at this stage
  console.error('❌ Failed to check dependency versions:', error.message);
}
