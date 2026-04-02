import { beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';

import * as session from '../../../../../src/core/tools/session.js';
import { Phase } from '../../../../../src/core/types/index.js';

describe('exploreCodebase', () => {
  let mockCtx: any;
  let mockToolstack: any;
  let chatWithToolsSpy: any;

  async function runExplore(context: any) {
    const { exploreCodebase } = await import('../../../../../src/core/grizzco/steps/explore.js');
    return exploreCodebase(context);
  }

  beforeEach(() => {
    mock.clearAllMocks();
    chatWithToolsSpy = spyOn(session, 'chatWithTools');
    spyOn(session, 'chatWithToolsStreaming');

    mockToolstack = {
      router: {
        call: mock().mockResolvedValue({ toolName: 'test', status: 'ok', output: 'ok' }),
      },
      registry: {
        getSpec: mock(),
        listAll: mock().mockReturnValue([
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
          getCapabilities: () => ({ toolCalling: true }),
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
      emit: mock(),
    };
  });

  it('skips exploration if tools are disabled', async () => {
    mockCtx.options.llm.getCapabilities = () => ({ toolCalling: false });

    const result = await runExplore(mockCtx);

    expect(result).toEqual(expect.objectContaining({ context: mockCtx.context }));
    expect(mockCtx.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'log',
        message: expect.stringContaining('Exploration skipped'),
      }),
    );
    expect(chatWithToolsSpy).not.toHaveBeenCalled();
  });

  it('skips exploration if toolstack is missing', async () => {
    mockCtx.toolstack = undefined;

    await runExplore(mockCtx);

    expect(chatWithToolsSpy).not.toHaveBeenCalled();
    expect(mockCtx.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'log',
        message: expect.stringContaining('Exploration skipped'),
      }),
    );
  });

  it('returns an error when exploration does not capture readable files', async () => {
    const mockRuntimeCtx = {
      repoRoot: '/tmp/test',
      attemptId: 1,
      dryRun: false,
    };

    // Mock chatWithTools to simulate the LLM using the tool
    spyOn(session, 'chatWithTools').mockImplementation(
      async (_messages: any, _options: any, runtime: any) => {
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
              output: { content: null },
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
      },
    );

    await expect(runExplore(mockCtx)).rejects.toThrow(
      'No files were read during the exploration phase',
    );
  });

  it('fails if fs.read does not produce captured content', async () => {
    const mockRuntimeCtx = {
      repoRoot: '/tmp/test',
      attemptId: 1,
      dryRun: false,
    };

    spyOn(session, 'chatWithTools').mockImplementation(
      async (_messages: any, _options: any, runtime: any) => {
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
      },
    );

    await expect(runExplore(mockCtx)).rejects.toThrow(
      'No files were read during the exploration phase',
    );
    expect(mockCtx.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'log',
        level: 'error',
        message: expect.stringContaining('No files were read during the exploration phase'),
      }),
    );
  });

  it('reports an error when streaming exploration captures no readable files', async () => {
    const mockRuntimeCtx = {
      repoRoot: '/tmp/test',
      attemptId: 1,
      dryRun: false,
    };

    mockCtx.options.llm.chatStream = mock(); // Enable streaming support

    spyOn(session, 'chatWithToolsStreaming').mockImplementation(
      async (_messages: any, _options: any, runtime: any) => {
        const router = runtime.toolstack.router;

        mockToolstack.router.call.mockResolvedValue({
          toolName: 'fs.read',
          status: 'ok',
          output: { content: null },
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

    await expect(runExplore(mockCtx)).rejects.toThrow(
      'No files were read during the exploration phase',
    );
  });

  it('propagates exploration failure when tool execution recovers without captures', async () => {
    const mockRuntimeCtx = {
      repoRoot: '/tmp/test',
      attemptId: 1,
      dryRun: false,
    };

    spyOn(session, 'chatWithTools').mockImplementation(
      async (_messages: any, _options: any, runtime: any) => {
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
          output: { content: null },
        });

        await router.call({
          id: '2',
          phase: Phase.EXPLORE,
          toolName: 'fs.read',
          args: { file: '/tmp/test/read.ts' },
          ctx: mockRuntimeCtx,
        });

        return { role: 'assistant', content: 'done' } as any;
      },
    );

    await expect(runExplore(mockCtx)).rejects.toThrow(
      'No files were read during the exploration phase',
    );
  });

  it('injects recent read artifact handles into the explore request envelope', async () => {
    const captured: any[][] = [];
    const mockRuntimeCtx = {
      repoRoot: '/tmp/test',
      attemptId: 1,
      dryRun: false,
    };

    mockCtx.artifactHints = {
      recentReadArtifacts: [
        {
          path: 'src/previous.ts',
          artifact: {
            handle: 's8p://artifact/recent-read-1',
            mimeType: 'text/plain',
            sha256: 'abc123',
            size: 321,
          },
        },
      ],
    };

    spyOn(session, 'chatWithTools').mockImplementation(
      async (messages: any, _options: any, runtime: any) => {
        captured.push(messages.map((m: any) => ({ role: m.role, content: m.content })));
        const router = runtime.toolstack.router;

        mockToolstack.router.call.mockResolvedValue({
          toolName: 'fs.read',
          status: 'ok',
          output: { content: 'export const value = 1;' },
        });

        await router.call({
          id: 'capture-1',
          phase: Phase.EXPLORE,
          toolName: 'fs.read',
          args: { file: 'src/captured.ts' },
          ctx: mockRuntimeCtx,
        });

        return { role: 'assistant', content: 'done' } as any;
      },
    );

    const out = await runExplore(mockCtx);

    const lastUserMessage = captured[0][captured[0].length - 1];
    expect(lastUserMessage.role).toBe('user');
    expect(lastUserMessage.content).toContain('s8p://artifact/recent-read-1');
    expect(lastUserMessage.content).toContain('src/previous.ts');
    expect(lastUserMessage.content).toContain('artifact.read');
    expect(out.explorationSummary?.filesFound).toBeGreaterThan(0);
  });
});
