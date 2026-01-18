import { describe, it, expect } from 'vitest';
import { validateDiff } from '../../src/core/diff';
import { LIMITS } from '../../src/core/limits';

describe('validateDiff', () => {
  it('should pass for valid diff', () => {
    const diff = `diff --git a/file b/file
index 123..456 100644
--- a/file
+++ b/file
@@ -1 +1 @@
-old
+new`;
    expect(() => validateDiff(diff)).not.toThrow();
  });

  it('should throw for invalid format', () => {
    const diff = 'not a diff';
    expect(() => validateDiff(diff)).toThrow('Invalid diff format');
  });

  it('should throw if too many files changed', () => {
    const diff = `diff --git a/1 b/1
...
diff --git a/2 b/2
...
diff --git a/3 b/3
...`;
    // Assuming default limit is 2
    expect(() => validateDiff(diff)).toThrow('Exceeds max files changed');
  });

  it('should throw if too many lines changed', () => {
    // Create a diff with many lines
    const lines = Array(LIMITS.maxDiffLines + 10).fill('+line').join('\n');
    const diff = `diff --git a/file b/file
index 123..456 100644
--- a/file
+++ b/file
@@ -0,0 +1,${LIMITS.maxDiffLines + 10} @@
${lines}`;
    expect(() => validateDiff(diff)).toThrow('Exceeds max diff lines');
  });
});
