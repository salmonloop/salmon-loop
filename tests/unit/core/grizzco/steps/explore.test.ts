import { describe, it, expect, vi, beforeEach } from 'vitest';

import * as strategy from '../../../../../src/core/grizzco/dsl/llm-strategy.js';
import { exploreCodebase } from '../../../../../src/core/grizzco/steps/explore.js';
import * as session from '../../../../../src/core/tools/session.js';
import { Phase } from '../../../../../src/core/types.js';

// Mock dependencies
vi.mock('../../../../../src/core/tools/session.js', () => ({
  chatWithTools: vi.fn(),
  chatWithToolsStreaming: vi.fn(),
}));

vi.mock('../../../../../src/core/grizzco/dsl/llm-strategy.js', () => ({
  resolveLlmToolCallingPolicy: vi.fn(),
}));

vi.mock('../../../../../src/core/prompt.js', () => ({
  getExplorePrompt: vi.fn().mockResolvedValue('Mock Prompt'),
  getExploreSystemPrompt: vi.fn().mockResolvedValue('Mock System Prompt'),
}));

describe('exploreCodebase', () => {
  let mockCtx: any;
  let mockToolstack: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockToolstack = {
      router: {
        call: vi.fn().mockResolvedValue({ toolName: 'test', status: 'ok', output: 'ok' }),
      },
      registry: {
        getSpec: vi.fn(),
        listAll: vi.fn().mockReturnValue([
          { name: 'fs.read', intent: 'READ' },
          { name: 'code.search', intent: 'SEARCH' },
        ]),
      },
    };

    mockCtx = {
      toolstack: mockToolstack,
      options: {
        llm: {
          getModelId: () => 'test-model',
        },
        instruction: 'Fix the bug',
      },
      context: {
        primaryFile: 'src/main.ts',
        relatedFiles: [],
      },
      workspace: {
        workPath: '/tmp/test',
        strategy: 'worktree',
      },
      emit: vi.fn(),
    };
  });

  it('skips exploration if tools are disabled', async () => {
    vi.mocked(strategy.resolveLlmToolCallingPolicy).mockReturnValue({
      enabled: false,
      maxRounds: 10,
    });

    const result = await exploreCodebase(mockCtx);

    expect(result).toEqual(expect.objectContaining({ context: mockCtx.context }));
    expect(mockCtx.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'log',
        message: expect.stringContaining('Exploration skipped'),
      }),
    );
    expect(session.chatWithTools).not.toHaveBeenCalled();
  });

  it('skips exploration if toolstack is missing', async () => {
    vi.mocked(strategy.resolveLlmToolCallingPolicy).mockReturnValue({
      enabled: true,
      maxRounds: 10,
    });
    mockCtx.toolstack = undefined;

    await exploreCodebase(mockCtx);

    expect(session.chatWithTools).not.toHaveBeenCalled();
    expect(mockCtx.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'log',
        message: expect.stringContaining('Exploration skipped'),
      }),
    );
  });

  it('executes chatWithTools and captures fs.read calls', async () => {
    vi.mocked(strategy.resolveLlmToolCallingPolicy).mockReturnValue({
      enabled: true,
      maxRounds: 10,
    });

    const mockRuntimeCtx = {
      repoRoot: '/tmp/test',
      attemptId: 1,
      dryRun: false,
    };

    // Mock chatWithTools to simulate the LLM using the tool
    vi.mocked(session.chatWithTools).mockImplementation(async (_messages, _options, runtime) => {
      // simulate the runtime calling the tool via the proxied router
      const router = runtime.toolstack.router;

      // 1. Call a random tool (should not be captured)
      await router.call({
        id: '1',
        phase: Phase.EXPLORE,
        toolName: 'ls',
        args: { path: '.' },
        ctx: mockRuntimeCtx,
      });

      // 2. Call fs.read (should be captured)
      // We need to verify that the router passed to chatWithTools is indeed our proxy
      // And we need to make sure the UNDERLYING router returns the content so the proxy sees it

      // Update mock underlying router to return file content
      mockToolstack.router.call.mockImplementation(async (envelope: any) => {
        if (envelope.toolName === 'fs.read') {
          return {
            toolName: 'fs.read',
            status: 'ok',
            output: 'file content here',
          };
        }
        return { toolName: envelope.toolName, status: 'ok', output: 'list' };
      });

      await router.call({
        id: '2',
        phase: Phase.EXPLORE,
        toolName: 'fs.read',
        args: { path: '/tmp/test/read.ts' },
        ctx: mockRuntimeCtx,
      });

      return { role: 'assistant', content: 'done' } as any;
    });

    const result = await exploreCodebase(mockCtx);

    // Verify relatedFiles contains the captured file
    expect(result.context.relatedFiles).toHaveLength(1);
    expect(result.context.relatedFiles![0]).toEqual({
      path: '/tmp/test/read.ts',
      content: 'file content here',
      kind: 'dependency',
      mode: 'full',
    });

    // Verify log emission
    expect(mockCtx.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'log',
        message: expect.stringContaining('Exploration finished. Added 1 files'),
      }),
    );
  });

  it('warns if fs.read does not produce captured content', async () => {
    vi.mocked(strategy.resolveLlmToolCallingPolicy).mockReturnValue({
      enabled: true,
      maxRounds: 10,
    });

    const mockRuntimeCtx = {
      repoRoot: '/tmp/test',
      attemptId: 1,
      dryRun: false,
    };

    vi.mocked(session.chatWithTools).mockImplementation(async (_messages, _options, runtime) => {
      const router = runtime.toolstack.router;

      mockToolstack.router.call.mockResolvedValue({
        toolName: 'fs.read',
        status: 'error',
        output: 'File not found',
      });

      await router.call({
        id: '1',
        phase: Phase.EXPLORE,
        toolName: 'fs.read',
        args: { path: '/tmp/test/missing.ts' },
        ctx: mockRuntimeCtx,
      });

      return { role: 'assistant', content: 'done' } as any;
    });

    const out = await exploreCodebase(mockCtx);

    expect(out).toEqual(expect.objectContaining({ context: mockCtx.context }));
    expect(mockCtx.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'log',
        level: 'warn',
        message: expect.stringContaining('No files were read during the exploration phase'),
      }),
    );
  });

  it('uses chatWithToolsStreaming if LLM supports streaming', async () => {
    vi.mocked(strategy.resolveLlmToolCallingPolicy).mockReturnValue({
      enabled: true,
      maxRounds: 10,
    });

    const mockRuntimeCtx = {
      repoRoot: '/tmp/test',
      attemptId: 1,
      dryRun: false,
    };

    mockCtx.options.llm.chatStream = vi.fn(); // Enable streaming support

    vi.mocked(session.chatWithToolsStreaming).mockImplementation(
      async (_messages, _options, runtime) => {
        const router = runtime.toolstack.router;

        mockToolstack.router.call.mockResolvedValue({
          toolName: 'fs.read',
          status: 'ok',
          output: 'streaming read content',
        });

        await router.call({
          id: 'stream-1',
          phase: Phase.EXPLORE,
          toolName: 'fs.read',
          args: { file: '/tmp/test/read.ts' },
          ctx: mockRuntimeCtx,
        });

        return { role: 'assistant', content: 'done' } as any;
      },
    );

    await exploreCodebase(mockCtx);

    expect(session.chatWithToolsStreaming).toHaveBeenCalled();
    expect(session.chatWithTools).not.toHaveBeenCalled();
  });

  it('handles tool call exceptions gracefully', async () => {
    vi.mocked(strategy.resolveLlmToolCallingPolicy).mockReturnValue({
      enabled: true,
      maxRounds: 10,
    });

    const mockRuntimeCtx = {
      repoRoot: '/tmp/test',
      attemptId: 1,
      dryRun: false,
    };

    vi.mocked(session.chatWithTools).mockImplementation(async (_messages, _options, runtime) => {
      const router = runtime.toolstack.router;

      // Simulate underlying router throwing error
      mockToolstack.router.call.mockRejectedValue(new Error('Tool failed'));

      await expect(
        router.call({
          id: '1',
          phase: Phase.EXPLORE,
          toolName: 'crash',
          args: {},
          ctx: mockRuntimeCtx,
        }),
      ).rejects.toThrow('Tool failed');

      mockToolstack.router.call.mockResolvedValue({
        toolName: 'fs.read',
        status: 'ok',
        output: 'recovered read',
      });

      await router.call({
        id: '2',
        phase: Phase.EXPLORE,
        toolName: 'fs.read',
        args: { file: '/tmp/test/read.ts' },
        ctx: mockRuntimeCtx,
      });

      return { role: 'assistant', content: 'done' } as any;
    });

    await exploreCodebase(mockCtx);
  });
});
