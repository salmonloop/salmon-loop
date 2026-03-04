import type { LoopOptions } from '../../types/runtime.js';

export function collectSidecarPaths(options: LoopOptions): string[] {
  if (!options.contextFiles || options.contextFiles.length === 0) {
    return [];
  }

  const paths = new Set<string>();
  for (const filePath of options.contextFiles) {
    if (filePath) {
      paths.add(filePath);
    }
  }

  return Array.from(paths);
}
