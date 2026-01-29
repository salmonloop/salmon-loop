import { formatContextForPrompt } from '../../src/core/llm-utils.js';
import { OpenAILLM } from '../../src/core/llm.js';
import { Context } from '../../src/core/types.js';

// Mock OpenAI
const mockCreate = vi.fn();
vi.mock('openai', () => {
  return {
    default: class {
      chat = {
        completions: {
          create: mockCreate,
        },
      };
    },
  };
});

describe('OpenAILLM', () => {
  let llm: OpenAILLM;
  const mockContext: Context = { repoPath: '.', rgSnippets: [] } as any;

  beforeEach(() => {
    vi.stubEnv('SALMON_API_KEY', 'test-key');
    llm = new OpenAILLM();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  describe('createPlan', () => {
    it('should parse valid JSON response', async () => {
      const plan = { goal: 'test', files: [], changes: [], verify: 'test' };
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: JSON.stringify(plan) } }],
      });

      const result = await llm.createPlan(mockContext, 'instruction');
      expect(result).toEqual(plan);
    });

    it('should throw error for invalid JSON', async () => {
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: 'invalid json' } }],
      });

      await expect(llm.createPlan(mockContext, 'instruction')).rejects.toThrow(
        'Failed to parse LLM response',
      );
    });

    it('should throw error for missing fields', async () => {
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: JSON.stringify({ goal: 'test' }) } }],
      });

      await expect(llm.createPlan(mockContext, 'instruction')).rejects.toThrow(
        'Invalid Plan structure',
      );
    });
  });

  describe('createPatch', () => {
    it('should clean up markdown code blocks', async () => {
      const diff = 'diff --git a/file b/file\n...';
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: `\`\`\`diff\n${diff}\n\`\`\`` } }],
      });

      const result = await llm.createPatch(mockContext, {} as any);
      expect(result).toBe(diff);
    });

    it('should handle plain text diff', async () => {
      const diff = 'diff --git a/file b/file\n...';
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: diff } }],
      });

      const result = await llm.createPatch(mockContext, {} as any);
      expect(result).toBe(diff);
    });
  });

  describe('formatContext', () => {
    it('should inject markers for symbols', () => {
      const context: Context = {
        repoPath: '.',
        primaryFile: 'test.ts',
        primaryText: 'function hello() {\n  world();\n}',
        symbols: [
          {
            name: 'hello',
            kind: 'definition',
            location: { start: { line: 1, column: 9 }, end: { line: 1, column: 14 } },
          },
          {
            name: 'world',
            kind: 'reference',
            location: { start: { line: 2, column: 2 }, end: { line: 2, column: 7 } },
          },
        ],
        rgSnippets: [],
      } as any;

      const formatted = formatContextForPrompt(context);
      expect(formatted).toContain('function hello() {');
      expect(formatted).toContain('  world();ℹ️');
    });
  });
});
