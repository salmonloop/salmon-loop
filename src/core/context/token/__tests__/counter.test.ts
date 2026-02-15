import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { TokenCounter } from '../counter.js';
// types are imported for documentation purposes

describe('TokenCounter', () => {
  let counter: TokenCounter;

  beforeEach(async () => {
    counter = new TokenCounter();
    await counter.initialize();
  });

  afterEach(() => {
    counter.dispose();
  });

  describe('initialization', () => {
    it('should be initialized after initialize()', () => {
      expect(counter.isInitialized()).toBe(true);
    });

    it('should list registered encodings', () => {
      const encodings = counter.getRegisteredEncodings();
      expect(encodings).toContain('cl100k_base');
      expect(encodings).toContain('o200k_base');
    });

    it('should list registered models', () => {
      const models = counter.getRegisteredModels();
      expect(models).toContain('openai-gpt4');
      expect(models).toContain('openai-gpt4o');
      expect(models).toContain('anthropic-claude');
    });
  });

  describe('count', () => {
    it('should count tokens in simple text', () => {
      const tokens = counter.count('Hello, world!');
      expect(tokens).toBeGreaterThan(0);
      expect(tokens).toBeLessThan(10); // Should be around 4 tokens
    });

    it('should count tokens in code', () => {
      const code = `function hello() {\n  return "world";\n}`;
      const tokens = counter.count(code);
      expect(tokens).toBeGreaterThan(0);
    });

    it('should count tokens in Chinese text', () => {
      const text = '你好世界';
      const tokens = counter.count(text);
      expect(tokens).toBeGreaterThan(0);
      // Chinese characters typically use more tokens
    });

    it('should use specified encoding', () => {
      const text = 'Hello, world!';
      const tokens1 = counter.count(text, 'cl100k_base');
      const tokens2 = counter.count(text, 'o200k_base');

      // Both should return valid counts
      expect(tokens1).toBeGreaterThan(0);
      expect(tokens2).toBeGreaterThan(0);
    });
  });

  describe('countByModel', () => {
    it('should count tokens for GPT-4', () => {
      const tokens = counter.countByModel('Hello', 'openai-gpt4');
      expect(tokens).toBeGreaterThan(0);
    });

    it('should count tokens for GPT-4o', () => {
      const tokens = counter.countByModel('Hello', 'openai-gpt4o');
      expect(tokens).toBeGreaterThan(0);
    });

    it('should count tokens for Claude', () => {
      const tokens = counter.countByModel('Hello', 'anthropic-claude');
      expect(tokens).toBeGreaterThan(0);
    });
  });

  describe('countWithMeta', () => {
    it('should return metadata with token count', () => {
      const result = counter.countWithMeta('Hello, world!');

      expect(result.tokens).toBeGreaterThan(0);
      expect(result.cached).toBe(false); // First time
      expect(result.encoding).toBe('cl100k_base'); // Default
    });

    it('should cache results', () => {
      counter.countWithMeta('Hello, world!');
      const result = counter.countWithMeta('Hello, world!');

      expect(result.cached).toBe(true);
    });
  });

  describe('countBatch', () => {
    it('should count tokens for multiple texts', () => {
      const texts = ['Hello', 'World', 'Test'];
      const tokens = counter.countBatch(texts);

      expect(tokens).toHaveLength(3);
      expect(tokens.every((t) => t > 0)).toBe(true);
    });
  });

  describe('countTotal', () => {
    it('should sum tokens for multiple texts', () => {
      const texts = ['Hello', 'World'];
      const total = counter.countTotal(texts);

      expect(total).toBeGreaterThan(0);
      expect(total).toBe(counter.count('Hello') + counter.count('World'));
    });
  });

  describe('cache management', () => {
    it('should provide cache statistics', () => {
      counter.countWithMeta('Hello');
      counter.countWithMeta('Hello'); // Cache hit

      const stats = counter.getCacheStats();
      expect(stats.hits).toBeGreaterThan(0);
    });

    it('should clear cache', () => {
      counter.countWithMeta('Hello');
      counter.clearCache();

      const result = counter.countWithMeta('Hello');
      expect(result.cached).toBe(false);
    });
  });

  describe('encoding mapping', () => {
    it('should return correct encoding for model', () => {
      expect(counter.getEncodingForModel('openai-gpt4')).toBe('cl100k_base');
      expect(counter.getEncodingForModel('openai-gpt4o')).toBe('o200k_base');
    });
  });
});
