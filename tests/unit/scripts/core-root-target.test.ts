import { describe, expect, it } from 'bun:test';

import { auditCoreRoot } from '../../../scripts/audit-core-root.ts';

describe('core root migration target', () => {
  it('does not keep migrated implementation files in src/core root', async () => {
    const report = await auditCoreRoot({ repoRoot: process.cwd() });
    const rootPaths = new Set(report.rootFiles.map((f) => f.path));

    const migratedFiles = [
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
    ];

    for (const file of migratedFiles) {
      expect(rootPaths.has(file), `${file} should be migrated out of root`).toBe(false);
    }
  });
});
