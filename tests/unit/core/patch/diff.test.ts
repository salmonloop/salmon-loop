import { describe, it, expect } from 'bun:test';

import { isUnifiedDiff } from '../../../../src/core/patch/diff.js';

describe('isUnifiedDiff', () => {
  it('should return true for a standard git diff', () => {
    const diff = `diff --git a/file.txt b/file.txt
--- a/file.txt
+++ b/file.txt
@@ -1,2 +1,3 @@
 line 1
 line 2
+line 3
`;
    expect(isUnifiedDiff(diff)).toBe(true);
  });

  it('should return true for a unified diff starting with --- a/', () => {
    const diff = `--- a/file.txt
+++ b/file.txt
@@ -1,2 +1,3 @@
 line 1
 line 2
+line 3
`;
    expect(isUnifiedDiff(diff)).toBe(true);
  });

  it('should handle markdown-wrapped git diffs', () => {
    const diff = `\`\`\`diff
diff --git a/file.txt b/file.txt
--- a/file.txt
+++ b/file.txt
@@ -1,2 +1,3 @@
 line 1
 line 2
+line 3
\`\`\``;
    expect(isUnifiedDiff(diff)).toBe(true);
  });

  it('should handle markdown-wrapped git diffs starting with --- a/', () => {
    const diff = `\`\`\`
--- a/file.txt
+++ b/file.txt
@@ -1,2 +1,3 @@
 line 1
 line 2
+line 3
\`\`\``;
    expect(isUnifiedDiff(diff)).toBe(true);
  });

  it('should return false for arbitrary text', () => {
    expect(isUnifiedDiff('just some random text')).toBe(false);
  });

  it('should return false for empty string', () => {
    expect(isUnifiedDiff('')).toBe(false);
  });

  it('should return false for malformed patch missing unified header lines entirely', () => {
    const diff = `@@ -1,2 +1,3 @@
 line 1
`;
    expect(isUnifiedDiff(diff)).toBe(false);
  });

  it('should return false for malformed string looking like git index but missing headers', () => {
    const diff = `index 1234567..89abcdef 100644
@@ -1,2 +1,3 @@
 line 1
`;
    expect(isUnifiedDiff(diff)).toBe(false);
  });

  it('should handle diffs with leading whitespace correctly', () => {
    const diff = `
  diff --git a/file.txt b/file.txt
  --- a/file.txt
  +++ b/file.txt
  @@ -1,2 +1,3 @@
   line 1
   line 2
  +line 3
`;
    // normalizeDiff strips the common indentation, so this is handled correctly
    expect(isUnifiedDiff(diff)).toBe(true);
  });
});
