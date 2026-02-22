import * as fs from 'fs/promises';
import * as os from 'os';
import path from 'path';

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { ArtifactStore } from '../../../src/core/sub-agent/artifacts/store.js';
import { ToolAuditLogger } from '../../../src/core/tools/audit.js';
import { BudgetGuard } from '../../../src/core/tools/budget.js';
import { registerAllBuiltins } from '../../../src/core/tools/builtin/index.js';
import { ToolPolicy } from '../../../src/core/tools/policy.js';
import { ToolRegistry } from '../../../src/core/tools/registry.js';
import { ToolRouter } from '../../../src/core/tools/router.js';
import { ToolSanitizer } from '../../../src/core/tools/sanitize.js';

describe('proposal.apply authorization args summary', () => {
  let sandboxTmpDir = '';
  let originalTmpDir = '';

  beforeEach(async () => {
    originalTmpDir = process.env.TMPDIR ?? '';
    sandboxTmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sl-proposal-apply-'));
    process.env.TMPDIR = sandboxTmpDir;
  });

  afterEach(async () => {
    process.env.TMPDIR = originalTmpDir;
    await fs.rm(sandboxTmpDir, { recursive: true, force: true });
  });

  test('includes changedFiles preview for confirmation UX', async () => {
    const saved = await ArtifactStore.saveText({
      content: `diff --git a/foo.txt b/foo.txt
index 0000000..1111111 100644
--- a/foo.txt
+++ b/foo.txt
@@ -1 +1 @@
-old
+new
`,
      mimeType: 'text/x-diff',
      fileExt: 'patch',
    });

    let captured: { argsSummary?: string } | undefined;

    const authorizationProvider = {
      async requestAuthorizationDeferred(request: { argsSummary?: string }) {
        captured = request;
        return { kind: 'pending', challenge: 'abc123', message: 'confirm' };
      },
      async requestAuthorization() {
        return { outcome: 'deny', reason: 'not used' };
      },
      async waitForAuthorization() {
        return null;
      },
    };

    const registry = new ToolRegistry();
    registerAllBuiltins(registry);
    const router = new ToolRouter(
      registry,
      new ToolPolicy(),
      new BudgetGuard(),
      new ToolAuditLogger(),
      new ToolSanitizer(),
      authorizationProvider as any,
      { authorizationMode: 'deferred' },
    );

    const result = await router.call({
      id: 'call-1',
      phase: 'VERIFY',
      toolName: 'proposal.apply',
      args: { handle: saved.handle, snapshotRef: 'HEAD' },
      ctx: {
        repoRoot: '/repo',
        worktreeRoot: '/worktree',
        persistenceRoot: '/repo',
        attemptId: 1,
        dryRun: true,
      },
    });

    expect(result.status).toBe('denied');
    expect(result.error?.code).toBe('AUTH_REQUIRED');

    expect(captured).toBeDefined();
    expect(captured?.argsSummary).toContain('changedFiles');
    expect(captured?.argsSummary).toContain('foo.txt');
  });
});
