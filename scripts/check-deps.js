import { verifyDependencyVersion } from '../src/core/dependency.js';

/**
 * Standalone script to check dependency versions
 */
function main() {
  try {
    const rootPath = process.cwd();
    verifyDependencyVersion(rootPath);
    console.log('✅ Dependency version verification completed');
  } catch (error) {
    console.error('❌ Failed to verify dependency versions:', error.message);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
