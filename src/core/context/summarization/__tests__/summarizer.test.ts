import { describe, it, expect, beforeEach, vi } from 'vitest';

import { ConversationSummarizer } from '../summarizer.js';
import { DEFAULT_SUMMARIZATION_CONFIG } from '../types.js';
import type {
  SummarizableMessage,
  SummarizationLLMClient,
  SummarizationTokenCounter,
} from '../types.js';

// Mock LLM client
const createMockLLM = (): SummarizationLLMClient => ({
  chat: vi.fn().mockResolvedValue({
    content: 'This is a summary of the conversation.',
  }),
});

// Mock token counter
const createMockTokenCounter = (): SummarizationTokenCounter => ({
  count: vi.fn((text: string) => Math.ceil(text.length / 4)), // Simple estimation
});

// Helper to create messages
const createMessages = (count: number): SummarizableMessage[] =>
  Array.from({ length: count }, (_, i) => ({
    id: `msg-${i}`,
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: `Message ${i} content that is long enough for testing purposes.`,
    timestamp: Date.now() + i,
  }));

describe('ConversationSummarizer', () => {
  let summarizer: ConversationSummarizer;
  let mockLLM: SummarizationLLMClient;
  let mockTokenCounter: SummarizationTokenCounter;

  beforeEach(async () => {
    mockLLM = createMockLLM();
    mockTokenCounter = createMockTokenCounter();

    summarizer = new ConversationSummarizer(mockLLM, mockTokenCounter, {
      ...DEFAULT_SUMMARIZATION_CONFIG,
      summaryModel: { model: 'test-model', temperature: 0 },
      triggerTokens: 100, // Low threshold for testing
    });

    await summarizer.initialize();
  });

  describe('initialization', () => {
    it('should initialize successfully', () => {
      expect(summarizer).toBeDefined();
    });

    it('should have empty initial state', () => {
      const state = summarizer.getState();
      expect(state.summary).toBe('');
      expect(state.summaryTokens).toBe(0);
      expect(state.summarizedMessageIds).toHaveLength(0);
    });
  });

  describe('state management', () => {
    it('should save and restore state', () => {
      summarizer['state'].summary = 'Test summary';
      summarizer['state'].summaryTokens = 10;
      summarizer['state'].summarizedMessageIds = ['msg-0', 'msg-1'];

      const state = summarizer.getState();
      summarizer.reset();
      summarizer.restoreState(state);

      const restored = summarizer.getState();
      expect(restored.summary).toBe('Test summary');
      expect(restored.summaryTokens).toBe(10);
      expect(restored.summarizedMessageIds).toEqual(['msg-0', 'msg-1']);
    });

    it('should reset state', () => {
      summarizer['state'].summary = 'Test summary';
      summarizer.reset();

      const state = summarizer.getState();
      expect(state.summary).toBe('');
      expect(state.summarizedMessageIds).toHaveLength(0);
    });
  });

  describe('shouldTrigger', () => {
    it('should not trigger with few messages', () => {
      const messages = createMessages(3);
      expect(summarizer.shouldTrigger(messages)).toBe(false);
    });

    it('should trigger with enough tokens', () => {
      // Create messages that will exceed threshold
      const messages = createMessages(20);
      expect(summarizer.shouldTrigger(messages)).toBe(true);
    });

    it('should not trigger while summary in progress', () => {
      const messages = createMessages(20);
      summarizer['summaryInProgress'] = true;
      expect(summarizer.shouldTrigger(messages)).toBe(false);
    });
  });

  describe('calculateTokens', () => {
    it('should calculate tokens for messages', () => {
      const messages = createMessages(5);
      const tokens = summarizer.calculateTokens(messages);
      expect(tokens).toBeGreaterThan(0);
    });

    it('should include summary tokens', () => {
      summarizer['state'].summaryTokens = 100;
      const messages = createMessages(5);
      const tokens = summarizer.calculateTokens(messages);
      expect(tokens).toBeGreaterThan(100);
    });
  });

  describe('getEffectiveContext', () => {
    it('should return messages when no summary', () => {
      const messages = createMessages(5);
      const context = summarizer.getEffectiveContext(messages);

      // Should have all messages (none summarized)
      expect(context.length).toBe(5);
    });

    it('should include summary when present', async () => {
      // Manually set up a summarized state
      summarizer['state'].summary = 'Previous summary';
      summarizer['state'].summarizedMessageIds = ['msg-0', 'msg-1', 'msg-2'];

      const messages = createMessages(5);
      const context = summarizer.getEffectiveContext(messages);

      // Should have summary + remaining messages
      expect(context[0].role).toBe('system');
      expect(context[0].content).toContain('Previous summary');
    });
  });

  describe('triggerSummarization', () => {
    it('should not trigger if threshold not met', async () => {
      const messages = createMessages(3);
      const result = await summarizer.triggerSummarization(messages);
      expect(result).toBeNull();
    });

    it('should return null in async mode', async () => {
      const messages = createMessages(20);
      const result = await summarizer.triggerSummarization(messages);
      // In async mode, returns null immediately
      expect(result).toBeNull();
    });

    it('should run summarization in sync mode', async () => {
      const syncSummarizer = new ConversationSummarizer(mockLLM, mockTokenCounter, {
        ...DEFAULT_SUMMARIZATION_CONFIG,
        summaryModel: { model: 'test-model' },
        triggerTokens: 100,
        async: false,
      });

      const messages = createMessages(20);
      const result = await syncSummarizer.triggerSummarization(messages);

      expect(result).not.toBeNull();
      expect(result?.messagesSummarized).toBeGreaterThan(0);
      expect(mockLLM.chat).toHaveBeenCalled();
    });
  });

  describe('forceSummarize', () => {
    it('should summarize even if threshold not met', async () => {
      const messages = createMessages(15); // More than keepRecentMessages
      const result = await summarizer.forceSummarize(messages);

      expect(result).not.toBeNull();
      expect(result?.messagesSummarized).toBeGreaterThan(0);
    });

    it('should return null if too few messages', async () => {
      const messages = createMessages(5); // Less than keepRecentMessages
      const result = await summarizer.forceSummarize(messages);
      expect(result).toBeNull();
    });
  });

  describe('getUsageRatio', () => {
    it('should return ratio of token usage', () => {
      const messages = createMessages(10);
      const ratio = summarizer.getUsageRatio(messages);
      expect(ratio).toBeGreaterThanOrEqual(0);
    });
  });
});
