import { validateDiff, normalizeDiff } from '../../src/core/diff.js';
import { LIMITS } from '../../src/core/limits.js';
import { text } from '../../src/locales/index.js';

describe('Diff Security & Normalization (Character-Level Parity)', () => {
  describe('Normalization Logic (Mirroring Legacy diff.test.ts)', () => {
    it('should unwrap markdown code blocks', () => {
      const raw = '```diff\ndiff --git a/a b/a\n```';
      expect(normalizeDiff(raw)).toBe('diff --git a/a b/a\n');
    });

    it('should trim whitespace', () => {
      const raw = '  \ndiff --git a/a b/a\n  ';
      expect(normalizeDiff(raw)).toBe('diff --git a/a b/a\n');
    });

    it('should dedent uniformly-indented diffs', () => {
      const raw = `  diff --git a/a b/a
  --- a/a
  +++ b/a
  @@ -1 +1 @@
  -old
  +new`;
      expect(normalizeDiff(raw)).toBe(
        'diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -1 +1 @@\n-old\n+new\n',
      );
    });

    it('should handle paths with spaces correctly (non-greedy regex)', () => {
      const raw = 'diff --git a/folder with spaces/file.ts b/folder with spaces/file.ts';
      const normalized = normalizeDiff(raw);
      expect(normalized).toContain(
        'diff --git a/folder with spaces/file.ts b/folder with spaces/file.ts',
      );
    });

    it('should handle paths containing " b/" substring (greedy regex defense)', () => {
      const raw = 'diff --git a/lib/util.ts b/lib/util.ts';
      const normalized = normalizeDiff(raw);
      expect(normalized).toContain('diff --git a/lib/util.ts b/lib/util.ts');
    });

    it('should correctly process multiple path components with non-greedy matching', () => {
      const raw = `diff --git a/src/core/diff.ts b/src/core/diff.ts
--- a/src/core/diff.ts
+++ b/src/core/diff.ts
@@ -1,1 +1,1 @@
-old
+new`;
      const normalized = normalizeDiff(raw);
      expect(normalized).toContain('diff --git a/src/core/diff.ts b/src/core/diff.ts');
      expect(normalized).toContain('--- a/src/core/diff.ts');
      expect(normalized).toContain('+++ b/src/core/diff.ts');
    });

    it('should strip repo name but keep common src dirs', () => {
      const raw = 'diff --git a/my-project-repo/src/index.ts b/my-project-repo/src/index.ts';
      expect(normalizeDiff(raw)).toBe('diff --git a/src/index.ts b/src/index.ts\n');
    });

    it('should NOT strip legitimate source directories like src/', () => {
      const rawDiff = `diff --git a/src/index.js b/src/index.js
--- a/src/index.js
+++ b/src/index.js
@@ -1,1 +1,2 @@
+/* Hello */`.trim();
      const meta = validateDiff(rawDiff);
      expect(meta.changedFiles).toEqual(['src/index.js']);
    });

    it('should handle conversational text before diff', () => {
      const raw =
        'Here is the patch:\n\ndiff --git a/file.ts b/file.ts\n--- a/file.ts\n+++ b/file.ts\n@@ -1,1 +1,1 @@\n-old\n+new';
      expect(normalizeDiff(raw)).toBe(
        'diff --git a/file.ts b/file.ts\n--- a/file.ts\n+++ b/file.ts\n@@ -1,1 +1,1 @@\n-old\n+new\n',
      );
    });
  });

  describe('Path Security (Strict Enforcement)', () => {
    it('should throw for absolute Windows paths', () => {
      const raw = 'diff --git a/C:\\Users\\test\\file.ts b/C:\\Users\\test\\file.ts';
      expect(() => normalizeDiff(raw)).toThrow(/Path traversal detected/);
    });

    it('should throw for absolute Unix paths', () => {
      const raw = 'diff --git a//etc/passwd b//etc/passwd';
      expect(() => normalizeDiff(raw)).toThrow(/Path traversal detected/);
    });

    it('should throw for path traversal with ..', () => {
      const raw = 'diff --git a/../../etc/passwd b/../../etc/passwd';
      expect(() => normalizeDiff(raw)).toThrow(/Path traversal detected/);
    });
  });

  describe('Validation Rules (Zero Index Access Policy)', () => {
    // UPDATED: File creation is now allowed via git apply --3way strategy
    it('should allow file creation', () => {
      const diff = `diff --git a/new b/new\nnew file mode 100644\n--- /dev/null\n+++ b/new\n@@ -0,0 +1 @@\n+new file`;
      expect(() => validateDiff(diff)).not.toThrow();
    });

    // UPDATED: File deletion is now allowed via git apply --3way strategy
    it('should allow file deletion', () => {
      const diff = `diff --git a/old b/old\ndeleted file mode 100644\n--- a/old\n+++ /dev/null\n@@ -1 +0,0 @@\n-old file`;
      expect(() => validateDiff(diff)).not.toThrow();
    });

    // UPDATED: Renames are now handled by Git Patch semantics, but validateDiff might still block explicit rename headers if not handled
    // The current implementation of validateDiff throws on 'rename from/to'.
    // If we want to support renames, we should update validateDiff or this test.
    // For now, assuming validateDiff STRICTLY validates "Unified Diff" format without rename headers for safety,
    // or that renames must be represented as Delete+Add in the diff text passed to LLM?
    // Actually, git apply handles renames. If validateDiff blocks it, we can't use it.
    // But let's stick to what the code DOES. The code throws.
    it('should throw for file rename', () => {
      const diff = `diff --git a/old b/new\nrename from old\nrename to new`;
      expect(() => validateDiff(diff)).toThrow(text.diff.fileRenameNotAllowed());
    });

    it('should support multi-file patches without headers', () => {
      const diff = `--- a/file1\n+++ b/file1\n@@ -1 +1 @@\n-old1\n+new1\n--- a/file2\n+++ b/file2\n@@ -1 +1 @@\n-old2\n+new2`;
      const meta = validateDiff(diff);
      expect(meta.changedFiles).toEqual(['file1', 'file2']);
    });

    it('should throw if too many lines changed', () => {
      const lines = Array(LIMITS.maxDiffLines + 10)
        .fill('+line')
        .join('\n');
      const diff = `diff --git a/file b/file\n--- a/file\n+++ b/file\n@@ -0,0 +1,${LIMITS.maxDiffLines + 10} @@\n${lines}`;
      expect(() => validateDiff(diff)).toThrow(
        text.diff.tooManyLines(LIMITS.maxDiffLines + 10, LIMITS.maxDiffLines),
      );
    });
  });
});
