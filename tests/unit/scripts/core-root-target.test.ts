import { describe, expect, it } from 'bun:test';

import {
  CORE_ROOT_MIGRATED_FILES,
  findMigratedCoreRootFiles,
} from '../../helpers/core-root-migration-targets.js';

describe('core root migration target (unit)', () => {
  it('returns empty when no migrated files are present', () => {
    const rootPaths = ['src/core/keep.ts', 'src/core/another.ts'];

    expect(findMigratedCoreRootFiles(rootPaths)).toEqual([]);
  });

  it('returns only migrated files that reappear in root paths', () => {
    const rootPaths = [
      'src/core/keep.ts',
      'src/core/runtime.ts',
      'src/core/loop.ts',
      'src/core/runtime.ts',
    ];

    expect(findMigratedCoreRootFiles(rootPaths)).toEqual([
      'src/core/runtime.ts',
      'src/core/loop.ts',
    ]);
  });

  it('uses declared migration targets as the single source of truth', () => {
    expect(CORE_ROOT_MIGRATED_FILES.length).toBeGreaterThan(0);
  });
});
