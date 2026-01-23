/**
 * Error Classifier for ShadowDriver
 *
 * Classifies errors to determine if they are environment-related
 * and should trigger fallback to ISOLATED strategy.
 */

/**
 * Check if an error is environment-related
 */
export function isEnvironmentError(error: any): boolean {
  const msg = String(error?.message || error?.stderr || '');

  // Module not found errors
  if (msg.includes('MODULE_NOT_FOUND') || msg.includes('Cannot find module')) return true;

  // File not found errors for critical dependency paths
  if (msg.includes('ENOENT') || msg.includes('no such file or directory')) {
    const critical = ['node_modules', '.pnpm', 'target/', 'build/', '.cache', 'toolchain'];
    return critical.some((p) => msg.includes(p));
  }

  // Permission errors
  if (/EACCES|EPERM|Permission denied/.test(msg)) return true;

  // Architecture mismatch errors
  if (/wrong ELF class|mach-o, but wrong architecture/.test(msg)) return true;

  // Windows-specific environment errors
  if (msg.includes('The system cannot find the path specified')) return true;
  if (msg.includes('is not recognized as an internal or external command')) return true;

  return false;
}
