import * as os from 'os';

import mockFs from 'mock-fs';
import { afterEach, describe, expect, it } from 'vitest';

import { ArtifactStore } from '../../../src/core/sub-agent/artifacts/store.js';
import { ToolAuditLogger } from '../../../src/core/tools/audit.js';
import { BudgetGuard } from '../../../src/core/tools/budget.js';
import { registerAllBuiltins } from '../../../src/core/tools/builtin/index.js';
import { ToolPolicy } from '../../../src/core/tools/policy.js';
import { ToolRegistry } from '../../../src/core/tools/registry.js';
import { ToolRouter } from '../../../src/core/tools/router.js';
import { ToolSanitizer } from '../../../src/core/tools/sanitize.js';

describe('proposal.apply authorization args summary', () => {
  afterEach(() => {
    mockFs.restore();
  });

  it('includes changedFiles preview for confirmation UX', async () => {
    const tmp = os.tmpdir();
    mockFs({
      [tmp]: {},
    });

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

    let captured: any;

    const authorizationProvider = {
      async requestAuthorizationDeferred(request: any) {
        captured = request;
        return { kind: 'pending', challenge: 'abc123', message: 'confirm' } as const;
      },
      async requestAuthorization() {
        return { outcome: 'deny', reason: 'not used' } as any;
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

    expect(captured).not.toBeNull();
    if (!captured?.argsSummary) {
      throw new Error('Expected argsSummary to be populated for deferred authorization.');
    }
    expect(captured.argsSummary).toContain('changedFiles');
    expect(captured.argsSummary).toContain('foo.txt');
  });
});
