import { describe, expect, it } from 'bun:test';

import { auditCoreRoot } from '../../scripts/audit-core-root.ts';
import { findMigratedCoreRootFiles } from '../helpers/core-root-migration-targets.js';

describe('core root migration target (integration)', () => {
  it('does not keep migrated implementation files in src/core root for this repository', async () => {
    const report = await auditCoreRoot({ repoRoot: process.cwd() });
    const migratedInRoot = findMigratedCoreRootFiles(report.rootFiles.map((f) => f.path));

    expect(migratedInRoot).toEqual([]);
  }, 30000);
});
