export const CORE_ROOT_MIGRATED_FILES = [
  'src/core/concurrency.ts',
  'src/core/runtime.ts',
  'src/core/context.ts',
  'src/core/path.ts',
  'src/core/limits.ts',
  'src/core/logger.ts',
  'src/core/llm.ts',
  'src/core/loop.ts',
  'src/core/types.ts',
  'src/core/diff.ts',
  'src/core/llm-utils.ts',
  'src/core/monitor.ts',
  'src/core/audit-file.ts',
  'src/core/audit-trail.ts',
  'src/core/verify.ts',
] as const;

export function findMigratedCoreRootFiles(rootPaths: Iterable<string>): string[] {
  const rootPathSet = new Set(rootPaths);
  return CORE_ROOT_MIGRATED_FILES.filter((file) => rootPathSet.has(file));
}
