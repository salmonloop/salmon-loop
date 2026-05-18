import { createRequire } from 'module';

const require = createRequire(import.meta.url);

function readPackageVersion(): string {
  try {
    const pkg = require('../../package.json') as { version?: unknown };
    if (typeof pkg.version === 'string' && pkg.version.trim()) {
      return pkg.version;
    }
  } catch {
    // Fall back for non-package runtime embeddings.
  }
  return '0.0.0';
}

export const PACKAGE_NAME = 'salmon-loop';
export const PACKAGE_VERSION = readPackageVersion();
