import * as fs from 'fs/promises';
import * as http from 'http';
import * as path from 'path';

import { z } from 'zod';

import { Pipeline } from '../../src/core/grizzco/engine/pipeline/pipeline.js';
import { saveAudit } from '../../src/core/grizzco/steps/audit.js';
import { generatePatch } from '../../src/core/grizzco/steps/patch.js';
import { AiSdkLLM } from '../../src/core/llm/ai-sdk.js';
import { LlmError } from '../../src/core/llm/errors.js';
import { chatWithTools } from '../../src/core/tools/session.js';
import type { ToolSpec } from '../../src/core/tools/types.js';
import { Phase } from '../../src/core/types.js';

type StubResponse =
  | { kind: 'json'; status?: number; body: any }
  | { kind: 'raw'; status?: number; body: string };

function createServerQueue() {
  const responses: StubResponse[] = [];
  const requests: Array<{ url: string; method: string }> = [];

  const server = http.createServer(async (req, res) => {
    requests.push({ url: req.url || '', method: req.method || '' });
    const next = responses.shift();
    if (!next) {
      res.statusCode = 500;
      res.end('No stub response configured');
      return;
    }

    res.statusCode = next.status ?? 200;
    res.setHeader('content-type', 'application/json; charset=utf-8');

    if (next.kind === 'raw') {
      res.end(next.body);
      return;
    }

    res.end(JSON.stringify(next.body));
  });

  return {
    server,
    requests,
    push: (r: StubResponse) => responses.push(r),
  };
}

function openAiChatResponse(content: string, toolCalls?: any[]) {
  return {
    id: 'chatcmpl-test',
    object: 'chat.completion',
    created: 0,
    model: 'gpt-test',
    choices: [
      {
        index: 0,
        finish_reason: toolCalls?.length ? 'tool_calls' : 'stop',
        message: {
          role: 'assistant',
          content,
          tool_calls: toolCalls,
        },
      },
    ],
  };
}

const fsReadToolSpec = {
  name: 'fs.read',
  source: 'builtin',
  intent: 'READ',
  description: 'Read file content',
  riskLevel: 'low',
  sideEffects: ['fs_read'],
  concurrency: 'parallel_ok',
  allowedPhases: [Phase.PATCH, Phase.PLAN, Phase.EXPLORE, Phase.CONTEXT, Phase.VERIFY],
  inputSchema: z.object({ file: z.string() }),
  outputSchema: z.object({ content: z.string(), size: z.number() }),
  executor: async () => ({ content: '', size: 0 }),
} satisfies ToolSpec<{ file: string }, { content: string; size: number }>;

describe('LLM stub server integration (no real network)', () => {
  const q = createServerQueue();
  let baseUrl = '';

  beforeAll(async () => {
    await new Promise<void>((resolve) => {
      q.server.listen(0, '127.0.0.1', () => resolve());
    });
    const addr = q.server.address();
    if (!addr || typeof addr === 'string') throw new Error('Failed to bind stub server');
    baseUrl = `http://127.0.0.1:${addr.port}/v1`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => q.server.close(() => resolve()));
  });

  it('wraps truncated JSON response as a stable error code', async () => {
    q.push({ kind: 'raw', body: '{"id":' });

    const llm = new AiSdkLLM({
      clientPackage: '@ai-sdk/openai',
      apiKey: 'test',
      baseUrl,
      modelId: 'gpt-test',
    });

    await expect(llm.chat([{ role: 'user', content: 'hi' }])).rejects.toMatchObject({
      code: 'LLM_HTTP_REQUEST_FAILED',
    });
  });

  it('normalizes malformed tool-call arguments from AI SDK and exits the loop', async () => {
    q.requests.length = 0;

    q.push({
      kind: 'json',
      body: openAiChatResponse('ok', [
        {
          id: 'call-1',
          type: 'function',
          function: { name: 'fs.read', arguments: '{not-json' },
        },
      ]),
    });

    const llm = new AiSdkLLM({
      clientPackage: '@ai-sdk/openai',
      apiKey: 'test',
      baseUrl,
      modelId: 'gpt-test',
    });
    const toolCallingAudit: any[] = [];

    await chatWithTools(
      [{ role: 'user', content: 'do a tool call' }],
      {},
      {
        phase: Phase.PATCH,
        llm,
        runtime: { repoRoot: 'C:\\repo', attemptId: 1, dryRun: true },
        toolstack: {
          registry: { listAll: () => [fsReadToolSpec] },
          policy: { decide: () => ({ allowed: true }) },
          router: {
            getSpec: (name: string) => (name === 'fs.read' ? fsReadToolSpec : undefined),
            call: async () => ({ status: 'error' }) as any,
          },
        },
        toolCallingAudit: { event: (e) => toolCallingAudit.push(e) },
        maxRounds: 1,
      },
    );

    expect(q.requests.length).toBe(1);
    expect(toolCallingAudit.length).toBe(2);
    expect(toolCallingAudit[0].toolName).toBe('fs.read');
    expect(toolCallingAudit[0].parsedArgsOk).toBe(true);
    expect(toolCallingAudit[0].parsedArgsPreview).toContain('{not-json');
    expect(toolCallingAudit[1].toolResultStatus).toBe('error');
  });

  it('returns stable error codes for empty patch and non-unified diff', async () => {
    const llm = new AiSdkLLM({
      clientPackage: '@ai-sdk/openai',
      apiKey: 'test',
      baseUrl,
      modelId: 'gpt-test',
    });
    // Force non-streaming path for deterministic prompt/response behavior in this test.
    (llm as any).chatStream = undefined;
    const baseCtx: any = {
      workspace: { workPath: 'C:\\repo', strategy: 'worktree' },
      options: { llm, instruction: 'test', dryRun: true },
      emit: () => {},
      context: { primaryFile: 'src/index.js', primaryText: 'const x = 1;' },
      plan: { goal: 'x', files: ['src/index.js'], changes: ['x'], verify: 'x' },
      toolstack: {
        registry: { listAll: () => [] },
        policy: { decide: () => ({ allowed: false }) },
        router: { call: async () => ({ status: 'error' }) as any },
      },
    };

    // Empty patch
    q.push({ kind: 'json', body: openAiChatResponse('') });
    await expect(generatePatch(baseCtx)).rejects.toMatchObject({ code: 'LLM_PATCH_EMPTY' });

    // Not unified diff
    q.push({
      kind: 'json',
      body: openAiChatResponse('+++ b/src/index.js\n+not-a-valid-diff'),
    });
    await expect(generatePatch(baseCtx)).rejects.toMatchObject({
      code: 'LLM_PATCH_NOT_UNIFIED_DIFF',
    });
  });

  it('writes error code and tool calling audit events into structured audit output', async () => {
    const auditDir = path.join(process.cwd(), '.salmonloop', 'runtime', 'audit');
    await fs.mkdir(auditDir, { recursive: true });

    const before = new Set(await fs.readdir(auditDir));

    const err = new LlmError('test error', 'LLM_PATCH_EMPTY');
    const report = await Pipeline.of({
      toolCallingAudit: [
        {
          timestamp: new Date().toISOString(),
          phase: Phase.PATCH,
          round: 0,
          callId: 'call-1',
          toolName: 'fs.read',
          rawArgsType: 'string',
          parsedArgsOk: false,
          toolResultErrorCode: 'INVALID_TOOL_ARGUMENTS_JSON',
        },
      ],
    } as any)
      .step('PATCH', async () => {
        throw err;
      })
      .execute();

    const noopLlm = {
      chat: async () => ({ role: 'assistant' as const, content: '' }),
      createPlan: async () => ({ goal: '', files: [], changes: [], verify: '' }),
      createPatch: async () => '',
    };

    await saveAudit(report as any, {
      instruction: 'audit',
      repoPath: process.cwd(),
      llm: noopLlm,
    });

    const after = await fs.readdir(auditDir);
    const created = after.find((f) => !before.has(f));
    expect(created).toBeTruthy();

    const content = JSON.parse(await fs.readFile(path.join(auditDir, created as string), 'utf8'));
    expect(content.meta.errorCode).toBe('LLM_PATCH_EMPTY');
    expect(content.context.toolCallingAudit[0].toolName).toBe('fs.read');

    await fs.rm(path.join(auditDir, created as string), { force: true });
  });
});
