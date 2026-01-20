import { describe, it, expect } from 'vitest';
import { calculateSimilarity, fuzzyContextMatch } from '../../src/core/diff.js';

describe('Fuzzy Matching', () => {
  describe('calculateSimilarity', () => {
    it('should return 1 for identical strings', () => {
      expect(calculateSimilarity('hello', 'hello')).toBe(1);
    });

    it('should return 0 for completely different strings', () => {
      expect(calculateSimilarity('abc', 'def')).toBe(0);
    });

    it('should return high similarity for minor differences', () => {
      const sim = calculateSimilarity('function hello()', 'function hello( )');
      expect(sim).toBeGreaterThan(0.9);
    });

    it('should handle empty strings', () => {
      expect(calculateSimilarity('', '')).toBe(1);
      expect(calculateSimilarity('a', '')).toBe(0);
    });
  });

  describe('fuzzyContextMatch', () => {
    const originalContent = `
function add(a, b) {
  return a + b;
}

function sub(a, b) {
  return a - b;
}
    `.trim();

    it('should match exact context', () => {
      const patch = `
--- a/file.js
+++ b/file.js
@@ -1,3 +1,3 @@
 function add(a, b) {
-  return a + b;
+  return a + b + 0;
 }
      `.trim();
      expect(fuzzyContextMatch(patch, originalContent)).toBe(true);
    });

    it('should match fuzzy context with minor whitespace differences', () => {
      const patch = `
--- a/file.js
+++ b/file.js
@@ -1,3 +1,3 @@
 function add(a, b)  {
-  return a + b;
+  return a + b + 0;
 }
      `.trim();
      // "function add(a, b)  {" vs "function add(a, b) {"
      expect(fuzzyContextMatch(patch, originalContent)).toBe(true);
    });

    it('should fail if context is too different', () => {
      const patch = `
--- a/file.js
+++ b/file.js
@@ -1,3 +1,3 @@
 function multiply(a, b) {
-  return a * b * c;
+  return a * b * 1;
 }
      `.trim();
      expect(fuzzyContextMatch(patch, originalContent)).toBe(false);
    });
  });
});
