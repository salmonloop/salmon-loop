import { validateDiff, normalizeDiff } from '../../src/core/diff.js';
import { LIMITS } from '../../src/core/limits.js';
import { text } from '../../src/locales/index.js';

describe('normalizeDiff', () => {
  it('should unwrap markdown code blocks', () => {
    const raw = '```diff\ndiff --git a/a b/a\n```';
    expect(normalizeDiff(raw)).toBe('diff --git a/a b/a\n');
  });
 
  it('should trim whitespace', () => {
    const raw = '  \ndiff --git a/a b/a\n  ';
    expect(normalizeDiff(raw)).toBe('diff --git a/a b/a\n');
  });
});

describe('validateDiff', () => {
  it('should pass for valid diff and return meta', () => {
    const diff = `diff --git a/file b/file
index 123..456 100644
--- a/file
+++ b/file
@@ -1 +1 @@
-old1
+new1`;
    const meta = validateDiff(diff);
    expect(meta.changedFiles).toEqual(['file']);
    expect(meta.fileCount).toBe(1);
    expect(meta.lineCount).toBe(2);
  });

  it('should throw for invalid format', () => {
    const diff = 'not a diff';
    expect(() => validateDiff(diff)).toThrow(text.diff.notUnifiedFormat);
  });

  it('should throw if too many files changed', () => {
    const diff = `diff --git a/1 b/1
index 123..456 100644
--- a/1
+++ b/1
@@ -1 +1 @@
-a
+b
diff --git a/2 b/2
index 123..456 100644
--- a/2
+++ b/2
@@ -1 +1 @@
-a
+b
diff --git a/3 b/3
index 123..456 100644
--- a/3
+++ b/3
@@ -1 +1 @@
-a
+b`;
    // Assuming default limit is 2
    expect(() => validateDiff(diff)).toThrow(
      text.diff.tooManyFiles(3, LIMITS.maxFilesChanged, ['1', '2', '3']),
    );
  });

  it('should throw if too many lines changed', () => {
    // Create a diff with many lines
    const lines = Array(LIMITS.maxDiffLines + 10)
      .fill('+line')
      .join('\n');
    const diff = `diff --git a/file b/file
index 123..456 100644
--- a/file
+++ b/file
@@ -0,0 +1,${LIMITS.maxDiffLines + 10} @@
${lines}`;
    expect(() => validateDiff(diff)).toThrow(
      text.diff.tooManyLines(LIMITS.maxDiffLines + 10, LIMITS.maxDiffLines),
    );
  });

  it('should throw for file creation', () => {
    const diff = `diff --git a/new b/new
new file mode 100644
index 0000000..1234567
--- /dev/null
+++ b/new
@@ -0,0 +1 @@
+new file`;
    expect(() => validateDiff(diff)).toThrow(text.diff.fileCreationNotAllowed());
  });

  it('should throw for file deletion', () => {
    const diff = `diff --git a/old b/old
deleted file mode 100644
index 1234567..0000000
--- a/old
+++ /dev/null
@@ -1 +0,0 @@
 -old file`;
    expect(() => validateDiff(diff)).toThrow(text.diff.fileDeletionNotAllowed());
  });

  it('should throw for file rename', () => {
    const diff = `diff --git a/old b/new
rename from old
rename to new`;
    expect(() => validateDiff(diff)).toThrow(text.diff.fileRenameNotAllowed());
  });

  it('should support multi-file patches without diff --git headers', () => {
    const diff = `--- a/file1
+++ b/file1
@@ -1 +1 @@
-old1
+new1
--- a/file2
+++ b/file2
@@ -1 +1 @@
-old2
+new2`;
    const meta = validateDiff(diff);
    expect(meta.changedFiles).toEqual(['file1', 'file2']);
    expect(meta.fileCount).toBe(2);
    expect(meta.lineCount).toBe(4);
  });

  it('should strip repository name from paths if LLM includes it', () => {
    const rawDiff = `
diff --git a/test-repo/index.js b/test-repo/index.js
--- a/test-repo/index.js
+++ b/test-repo/index.js
@@ -1,1 +1,2 @@
+/* Hello */
    `.trim();

    const meta = validateDiff(rawDiff);
    // We want it to be index.js, not test-repo/index.js
    expect(meta.changedFiles).toEqual(['index.js']);
  });

  it('should NOT strip legitimate source directories like src/', () => {
    const rawDiff = `
diff --git a/src/index.js b/src/index.js
--- a/src/index.js
+++ b/src/index.js
@@ -1,1 +1,2 @@
+/* Hello */
    `.trim();

    const meta = validateDiff(rawDiff);
    // We want it to be src/index.js, not index.js
    expect(meta.changedFiles).toEqual(['src/index.js']);
  });
});
