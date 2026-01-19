import { describe, it, expect } from 'vitest';
import { validateDiff } from '../../src/core/diff.js';
import { LIMITS } from '../../src/core/limits.js';

describe('Diff Security', () => {
  it('should throw error when new file mode is detected', () => {
    const diff = `diff --git a/old.ts b/new.ts
new file mode 100644
index 0000000..e69de29
--- /dev/null
+++ b/new.ts
@@ -0,0 +1 @@
+new content`;
    expect(() => validateDiff(diff)).toThrow();
  });

  it('should throw error when deleted file mode is detected', () => {
    const diff = `diff --git a/old.ts b/old.ts
deleted file mode 100644
index e69de29..0000000
--- a/old.ts
+++ /dev/null
@@ -1 +0,0 @@
-old content`;
    expect(() => validateDiff(diff)).toThrow();
  });

  it('should throw error when rename is detected', () => {
    const diff = `diff --git a/old.ts b/new.ts
rename from old.ts
rename to new.ts
index e69de29..e69de29 100644`;
    expect(() => validateDiff(diff)).toThrow();
  });

  it('should respect LIMITS', () => {
    const manyFilesDiff = Array.from({ length: LIMITS.maxFilesChanged + 1 }, (_, i) => `diff --git a/file${i}.ts b/file${i}.ts
--- a/file${i}.ts
+++ b/file${i}.ts
@@ -1 +1 @@
-old
+new`).join('\n');
    expect(() => validateDiff(manyFilesDiff)).toThrow();
  });
});
