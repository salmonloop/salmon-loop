import { describe, it, expect } from 'vitest';
import { normalizeDiff } from '../../src/core/diff.js';

describe('Path Normalization Repro', () => {
  it('should strip repository name from paths if LLM includes it', () => {
    const rawDiff = `
diff --git a/test-repo/index.js b/test-repo/index.js
--- a/test-repo/index.js
+++ b/test-repo/index.js
@@ -1,1 +1,2 @@
+/* Hello */
    `.trim();
    
    const normalized = normalizeDiff(rawDiff);
    // We want it to be index.js, not test-repo/index.js
    expect(normalized).toContain('--- a/index.js');
    expect(normalized).toContain('+++ b/index.js');
  });
});
