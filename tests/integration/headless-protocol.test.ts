import { utimes } from 'fs/promises';
import path from 'path';

import { afterEach, describe, expect, it } from 'bun:test';

import { buildBunCommand } from '../helpers/bun.js';
import { runCli } from '../helpers/cli-runner.js';
import {
  normalizeHeadlessIntegrationLines,
  pickAnthropicLifecycleLines,
  pickNativeLifecycleLines,
  pickOpenAiLifecycleLines,
  readJsonFixture,
} from '../helpers/headless-golden.js';
import {
  createOpenAiStreamingStub,
  openAiChatStreamChunk,
} from '../helpers/openai-streaming-stub.js';
import { RealFsTestHelper } from '../helpers/real-fs-helper.js';

describe('Headless protocol integration', () => {
  const helper = new RealFsTestHelper();

  afterEach(async () => {
    await helper.cleanup();
  });

  async function seedChatSession(repoPath: string, sessionId: string, mtimeMs?: number) {
    const relativePath = `.salmonloop/chat-sessions/${sessionId}.json`;
    await helper.writeFile(
      repoPath,
      relativePath,
      JSON.stringify(
        {
          meta: {
            id: sessionId,
            name: 'Test Session',
            repoPath,
            createdAt: 0,
            updatedAt: 0,
            totalIterations: 0,
            successfulIterations: 0,
            totalTokens: { input: 0, output: 0 },
            snapshots: [],
          },
          messages: [],
          iterations: [],
        },
        null,
        2,
      ),
    );
    if (typeof mtimeMs === 'number') {
      const stamp = new Date(mtimeMs);
      await utimes(path.join(repoPath, relativePath), stamp, stamp);
    }
  }

  async function writeOpenAiStubConfig(repoPath: string, baseUrl: string) {
    await helper.writeFile(
      repoPath,
      '.salmonloop/config/config.json',
      JSON.stringify(
        {
          version: 1,
          llm: {
            activeModel: 'main',
            providers: {
              openaiMain: {
                type: 'openai-compatible',
                client: { package: '@ai-sdk/openai-compatible' },
                api: {
                  baseUrl,
                  apiKey: 'stub-key',
                },
              },
            },
            models: {
              main: {
                provider: 'openaiMain',
                id: 'gpt-test',
              },
            },
          },
        },
        null,
        2,
      ),
    );
  }

  it('supports global -p print mode with --output-format json (implicit run command)', async () => {
    const repo = await helper.createGitRepo();

    const { exitCode, stdout } = await runCli([
      '-r',
      repo.path,
      '-p',
      'hello',
      '--output-format',
      'json',
      '--act-mode',
      'review',
      '--no-config-file',
    ]);

    expect(exitCode).toBe(0);
    const payload = JSON.parse(stdout) as any;
    expect(payload.session_id).toBeTruthy();
    expect(payload.structured_output).toBe(null);
    expect(payload.metadata).toMatchObject({
      command: 'run',
      repo_path: repo.path,
      instruction: 'hello',
      success: true,
      exit_code: 0,
    });
  }, 120000);

  it('supports global -p print mode with --output-format stream-json (implicit run command)', async () => {
    const repo = await helper.createGitRepo();
    await seedChatSession(repo.path, 'sess-print');

    const { exitCode, stdout } = await runCli([
      '-r',
      repo.path,
      '--resume',
      'sess-print',
      '-p',
      'hello',
      '--output-format',
      'stream-json',
      '--act-mode',
      'review',
      '--no-config-file',
    ]);

    expect(exitCode).toBe(0);
    const lines = stdout
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as any);

    expect(lines.length).toBeGreaterThanOrEqual(3);
    expect(lines[0]).toMatchObject({
      session_id: 'sess-print',
      event: { type: 'start', command: 'run', repo_path: repo.path, instruction: 'hello' },
    });

    const resultLine = lines.find((l) => l.event?.type === 'result');
    const endLine = lines[lines.length - 1];
    expect(resultLine).toMatchObject({
      session_id: 'sess-print',
      event: { type: 'result', success: true, exit_code: 0 },
    });
    expect(endLine).toMatchObject({
      session_id: 'sess-print',
      event: { type: 'end', success: true, exit_code: 0 },
    });

    const normalized = normalizeHeadlessIntegrationLines({
      lines: pickNativeLifecycleLines(lines),
      repoPath: repo.path,
    });
    const expected = readJsonFixture<any[]>(
      new URL('../fixtures/headless/integration/print-stream-json-native.json', import.meta.url),
    );
    expect(normalized).toEqual(expected);
  }, 120000);

  it('supports global -p print mode with --output-format stream-json --output-profile anthropic', async () => {
    const repo = await helper.createGitRepo();
    await seedChatSession(repo.path, 'sess-print-anthropic');

    const { exitCode, stdout } = await runCli([
      '-r',
      repo.path,
      '--resume',
      'sess-print-anthropic',
      '-p',
      'hello',
      '--output-format',
      'stream-json',
      '--output-profile',
      'anthropic',
      '--act-mode',
      'review',
      '--no-config-file',
    ]);

    expect(exitCode).toBe(0);
    const lines = stdout
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as any);

    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatchObject({
      type: 'start',
      session_id: 'sess-print-anthropic',
      command: 'run',
      repo_path: repo.path,
      instruction: 'hello',
    });
    expect(lines[1]).toMatchObject({
      type: 'result',
      session_id: 'sess-print-anthropic',
      success: true,
      exit_code: 0,
    });
    expect(lines[2]).toMatchObject({
      type: 'end',
      session_id: 'sess-print-anthropic',
      success: true,
      exit_code: 0,
    });

    const normalized = normalizeHeadlessIntegrationLines({
      lines: pickAnthropicLifecycleLines(lines),
      repoPath: repo.path,
    });
    const expected = readJsonFixture<any[]>(
      new URL('../fixtures/headless/integration/print-stream-json-anthropic.json', import.meta.url),
    );
    expect(normalized).toEqual(expected);
  }, 120000);

  it('supports global -p print mode with --output-format stream-json --output-profile openai', async () => {
    const repo = await helper.createGitRepo();

    const { exitCode, stdout } = await runCli([
      '-r',
      repo.path,
      '-p',
      'hello',
      '--output-format',
      'stream-json',
      '--output-profile',
      'openai',
      '--act-mode',
      'review',
      '--no-config-file',
    ]);

    expect(exitCode).toBe(0);
    const lines = stdout
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as any);

    expect(lines.length).toBeGreaterThanOrEqual(3);
    expect(lines[0]).toMatchObject({ type: 'response.created', sequence_number: 0 });
    expect(lines[1]).toMatchObject({ type: 'response.in_progress', sequence_number: 1 });

    const last = lines[lines.length - 1];
    expect(last).toMatchObject({
      type: 'response.completed',
      response: { object: 'response', output_text: expect.any(String) },
    });
    expect(String(last.response.output_text).length).toBeGreaterThan(0);

    const sequenceNumbers = lines.map((l) => l.sequence_number);
    expect(sequenceNumbers).toEqual([...sequenceNumbers.keys()]);

    const normalized = normalizeHeadlessIntegrationLines({
      lines: pickOpenAiLifecycleLines(lines),
      repoPath: repo.path,
    });
    const expected = readJsonFixture<any[]>(
      new URL('../fixtures/headless/integration/print-stream-json-openai.json', import.meta.url),
    );
    expect(normalized).toEqual(expected);
  }, 120000);

  it('executes shell.exec end-to-end in headless native stream-json when run --act-mode autopilot succeeds', async () => {
    const repo = await helper.createGitRepo({
      initialFiles: [
        { path: 'src/index.ts', content: 'console.log("hello");\n' },
        {
          path: 'mutate.ts',
          content: [
            'await Bun.write("src/index.ts", \'console.log("headless autopilot");\\n\');',
            'console.log("shell-ok");',
            '',
          ].join('\n'),
        },
        { path: '.gitignore', content: '.salmonloop/\n' },
      ],
    });
    const stub = createOpenAiStreamingStub();
    const instruction = 'Run the mutate script, then report success.';

    const mutateCommand = buildBunCommand('mutate.ts');
    stub.pushStream([
      openAiChatStreamChunk({
        delta: {
          role: 'assistant',
          tool_calls: [
            {
              index: 0,
              id: 'call-shell-exec',
              type: 'function',
              function: {
                name: 'shell.exec',
                arguments: JSON.stringify({ command: mutateCommand }),
              },
            },
          ],
        },
      }),
      openAiChatStreamChunk({ finishReason: 'tool_calls' }),
      '[DONE]',
    ]);
    stub.pushStream([
      openAiChatStreamChunk({
        delta: {
          role: 'assistant',
          content: 'Command completed.',
        },
      }),
      openAiChatStreamChunk({ finishReason: 'stop' }),
      '[DONE]',
    ]);

    const baseUrl = await stub.tryStart();
    if (!baseUrl) {
      throw new Error('OpenAI streaming stub could not bind; retry-hint regression did not run');
    }
    await writeOpenAiStubConfig(repo.path, baseUrl);

    try {
      const { exitCode, stdout } = await runCli([
        'run',
        '-r',
        repo.path,
        '--instruction',
        instruction,
        '--output-format',
        'stream-json',
        '--headless-include-tool-output',
        '--act-mode',
        'autopilot',
        '--mode',
        'yolo',
      ]);

      expect(exitCode).toBe(0);
      expect(stub.requests).toHaveLength(2);
      expect(stub.requests.every((request) => request.url === '/v1/chat/completions')).toBe(true);
      expect(stub.requests.every((request) => request.method === 'POST')).toBe(true);
      expect(stub.requests.every((request) => request.body.includes('"stream":true'))).toBe(true);

      const lines = stdout
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as any);

      expect(lines[0]).toMatchObject({
        session_id: expect.any(String),
        event: {
          type: 'start',
          command: 'run',
          repo_path: repo.path,
          instruction,
        },
      });

      const toolUseLine = lines.find(
        (line) =>
          line.parent_tool_use_id === 'call-shell-exec' &&
          line.event?.type === 'content_block_start' &&
          line.event?.content_block?.type === 'tool_use',
      );
      expect(toolUseLine).toMatchObject({
        parent_tool_use_id: 'call-shell-exec',
        event: {
          type: 'content_block_start',
          content_block: {
            type: 'tool_use',
            id: 'call-shell-exec',
            name: 'shell.exec',
          },
        },
      });

      const toolResultLine = lines.find(
        (line) =>
          line.parent_tool_use_id === 'call-shell-exec' &&
          line.event?.type === 'content_block_start' &&
          line.event?.content_block?.type === 'tool_result',
      );
      expect(toolResultLine?.event?.content_block?.content).toContain('tool=shell.exec status=ok');
      expect(toolResultLine?.event?.content_block?.content).toContain('"stdout":"shell-ok"');
      expect(toolResultLine?.event?.content_block?.content).toContain('"exitCode":0');

      const assistantDelta = lines.find(
        (line) =>
          line.event?.type === 'content_block_delta' &&
          line.event?.delta?.type === 'text_delta' &&
          line.event?.delta?.text === 'Command completed.',
      );
      expect(assistantDelta).toBeDefined();

      const resultLine = lines.find((line) => line.event?.type === 'result');
      const endLine = lines[lines.length - 1];
      expect(resultLine).toMatchObject({
        event: { type: 'result', success: true, exit_code: 0 },
      });
      expect(resultLine?.event?.changed_files).toContain('src/index.ts');
      expect(endLine).toMatchObject({
        event: { type: 'end', success: true, exit_code: 0 },
      });

      expect(await helper.readFile(repo.path, 'src/index.ts')).toBe(
        'console.log("headless autopilot");\n',
      );
    } finally {
      await stub.close();
    }
  }, 120000);

  it('preserves workspace mutations and persisted verify artifacts when headless autopilot verification fails', async () => {
    const repo = await helper.createGitRepo({
      initialFiles: [
        { path: 'src/index.ts', content: 'console.log("hello");\n' },
        { path: '.gitignore', content: '.salmonloop/\n' },
      ],
    });
    await helper.writeFile(
      repo.path,
      'mutate.ts',
      [
        'await Bun.write("src/index.ts", \'console.log("kept after verify");\\n\');',
        'console.log("shell-ok");',
        '',
      ].join('\n'),
    );
    await helper.writeFile(
      repo.path,
      'verify.ts',
      'console.error("verify failed");\nprocess.exit(1);\n',
    );

    const stub = createOpenAiStreamingStub();
    stub.pushStream([
      openAiChatStreamChunk({
        delta: {
          role: 'assistant',
          tool_calls: [
            {
              index: 0,
              id: 'call-shell-exec',
              type: 'function',
              function: {
                name: 'shell.exec',
                arguments: JSON.stringify({ command: buildBunCommand('mutate.ts') }),
              },
            },
          ],
        },
      }),
      openAiChatStreamChunk({ finishReason: 'tool_calls' }),
      '[DONE]',
    ]);
    stub.pushStream([
      openAiChatStreamChunk({ delta: { role: 'assistant', content: 'done' } }),
      openAiChatStreamChunk({ finishReason: 'stop' }),
      '[DONE]',
    ]);

    const baseUrl = await stub.tryStart();
    if (!baseUrl) {
      throw new Error('OpenAI streaming stub could not bind; retry-hint regression did not run');
    }
    await writeOpenAiStubConfig(repo.path, baseUrl);

    try {
      const { exitCode, stdout } = await runCli([
        'run',
        '-r',
        repo.path,
        '--instruction',
        'Run mutate.ts',
        '--verify',
        buildBunCommand('verify.ts'),
        '--output-format',
        'stream-json',
        '--act-mode',
        'autopilot',
        '--mode',
        'yolo',
      ]);

      expect(exitCode).toBe(1);
      expect(await helper.readFile(repo.path, 'src/index.ts')).toBe(
        'console.log("kept after verify");\n',
      );

      const lines = stdout
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as any);
      const resultLine = lines.find((line) => line.event?.type === 'result');
      expect(resultLine?.event?.audit_path).toBeTruthy();

      const sessionId = String(lines[0]?.session_id ?? '');
      expect(sessionId).toBeTruthy();
      const session = JSON.parse(
        String(await helper.readFile(repo.path, `.salmonloop/chat-sessions/${sessionId}.json`)),
      );
      expect(session.meta.artifactState.verifyArtifact.handle).toBeTruthy();
    } finally {
      await stub.close();
    }
  }, 120000);

  it('lets autopilot recover from retryable tool input errors in headless mode', async () => {
    const repo = await helper.createGitRepo({
      initialFiles: [{ path: '.gitignore', content: '.salmonloop/\n' }],
    });
    const stub = createOpenAiStreamingStub();
    const instruction = 'Create note.txt with exactly the text recovered.';

    stub.pushStream([
      openAiChatStreamChunk({
        delta: {
          role: 'assistant',
          tool_calls: [
            {
              index: 0,
              id: 'call-write-1',
              type: 'function',
              function: {
                name: 'fs.write_file',
                arguments: JSON.stringify({ path: 'note.txt', contents: 'recovered' }),
              },
            },
          ],
        },
      }),
      openAiChatStreamChunk({ finishReason: 'tool_calls' }),
      '[DONE]',
    ]);
    stub.pushStream([
      openAiChatStreamChunk({
        delta: {
          role: 'assistant',
          tool_calls: [
            {
              index: 0,
              id: 'call-write-2',
              type: 'function',
              function: {
                name: 'fs.write_file',
                arguments: JSON.stringify({ file: 'note.txt', content: 'recovered' }),
              },
            },
          ],
        },
      }),
      openAiChatStreamChunk({ finishReason: 'tool_calls' }),
      '[DONE]',
    ]);
    stub.pushStream([
      openAiChatStreamChunk({
        delta: { role: 'assistant', content: 'Recovered and wrote the file.' },
      }),
      openAiChatStreamChunk({ finishReason: 'stop' }),
      '[DONE]',
    ]);

    const baseUrl = await stub.tryStart();
    if (!baseUrl) {
      throw new Error('OpenAI streaming stub failed to bind; recovery regression test did not run');
    }
    await writeOpenAiStubConfig(repo.path, baseUrl);

    try {
      const { exitCode, stdout } = await runCli([
        'run',
        '-r',
        repo.path,
        '--instruction',
        instruction,
        '--output-format',
        'stream-json',
        '--act-mode',
        'autopilot',
        '--mode',
        'yolo',
      ]);

      expect(exitCode).toBe(0);
      expect(await helper.readFile(repo.path, 'note.txt')).toBe('recovered');
      expect(stub.requests).toHaveLength(3);

      const retryRequest = JSON.parse(stub.requests[1]!.body) as any;
      const retryToolMessage = retryRequest.messages.find(
        (message: any) => message.role === 'tool' && message.tool_call_id === 'call-write-1',
      );
      expect(retryToolMessage).toBeTruthy();

      const retryPayload = JSON.parse(retryToolMessage.content);
      expect(retryPayload.error?.code).toBe('INVALID_INPUT');
      expect(retryPayload.error?.retryable).toBe(true);
      expect(retryPayload.meta?.retryHint).toMatchObject({
        retryable: true,
      });
      expect(typeof retryPayload.meta?.retryHint?.kind).toBe('string');
      expect(typeof retryPayload.meta?.retryHint?.tool).toBe('string');

      const lines = stdout
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as any);
      const resultLine = lines.find((line) => line.event?.type === 'result');
      expect(resultLine?.event?.success).toBe(true);
    } finally {
      await stub.close();
    }
  }, 120000);

  it('round-trips mixed read/write autopilot tool batches in headless mode', async () => {
    const repo = await helper.createGitRepo({
      initialFiles: [
        { path: 'src/a.ts', content: 'export const a = 1;\n' },
        { path: 'src/b.ts', content: 'export const b = 2;\n' },
        { path: '.gitignore', content: '.salmonloop/\n' },
      ],
    });

    const stub = createOpenAiStreamingStub();
    stub.pushStream([
      openAiChatStreamChunk({
        delta: {
          role: 'assistant',
          tool_calls: [
            {
              index: 0,
              id: 'call-read-a',
              type: 'function',
              function: {
                name: 'fs.read',
                arguments: JSON.stringify({ file: 'src/a.ts' }),
              },
            },
            {
              index: 1,
              id: 'call-read-b',
              type: 'function',
              function: {
                name: 'fs.read',
                arguments: JSON.stringify({ file: 'src/b.ts' }),
              },
            },
            {
              index: 2,
              id: 'call-write-c',
              type: 'function',
              function: {
                name: 'fs.write_file',
                arguments: JSON.stringify({
                  file: 'src/c.ts',
                  content: 'export const c = 3;\n',
                }),
              },
            },
          ],
        },
      }),
      openAiChatStreamChunk({ finishReason: 'tool_calls' }),
      '[DONE]',
    ]);
    stub.pushStream([
      openAiChatStreamChunk({ delta: { role: 'assistant', content: 'done' } }),
      openAiChatStreamChunk({ finishReason: 'stop' }),
      '[DONE]',
    ]);

    const baseUrl = await stub.tryStart();
    if (!baseUrl) {
      throw new Error(
        'OpenAI streaming stub failed to bind; mixed batch regression test did not run',
      );
    }
    await writeOpenAiStubConfig(repo.path, baseUrl);

    try {
      const { exitCode } = await runCli([
        'run',
        '-r',
        repo.path,
        '--instruction',
        'Read src/a.ts and src/b.ts, then write src/c.ts.',
        '--output-format',
        'stream-json',
        '--act-mode',
        'autopilot',
        '--mode',
        'yolo',
      ]);

      expect(exitCode).toBe(0);
      expect(await helper.readFile(repo.path, 'src/c.ts')).toBe('export const c = 3;\n');
      expect(stub.requests).toHaveLength(2);

      const secondRequest = JSON.parse(stub.requests[1]!.body) as any;
      const toolMessages = secondRequest.messages.filter((message: any) => message.role === 'tool');
      expect(toolMessages.map((message: any) => message.tool_call_id)).toEqual([
        'call-read-a',
        'call-read-b',
        'call-write-c',
      ]);
    } finally {
      await stub.close();
    }
  }, 120000);

  it('completes a recoverable autopilot write flow through verify with correct changed_files', async () => {
    const repo = await helper.createGitRepo({
      initialFiles: [{ path: '.gitignore', content: '.salmonloop/\n' }],
    });
    await helper.writeFile(
      repo.path,
      'verify.ts',
      [
        'const content = await Bun.file("smoke.txt").text();',
        'if (content !== "autopilot smoke\\n") {',
        '  console.error("unexpected smoke content");',
        '  process.exit(1);',
        '}',
        '',
      ].join('\n'),
    );

    const stub = createOpenAiStreamingStub();
    stub.pushStream([
      openAiChatStreamChunk({
        delta: {
          role: 'assistant',
          tool_calls: [
            {
              index: 0,
              id: 'call-write-1',
              type: 'function',
              function: {
                name: 'fs.write_file',
                arguments: JSON.stringify({ path: 'smoke.txt', contents: 'autopilot smoke\n' }),
              },
            },
          ],
        },
      }),
      openAiChatStreamChunk({ finishReason: 'tool_calls' }),
      '[DONE]',
    ]);
    stub.pushStream([
      openAiChatStreamChunk({
        delta: {
          role: 'assistant',
          tool_calls: [
            {
              index: 0,
              id: 'call-write-2',
              type: 'function',
              function: {
                name: 'fs.write_file',
                arguments: JSON.stringify({ file: 'smoke.txt', content: 'autopilot smoke\n' }),
              },
            },
          ],
        },
      }),
      openAiChatStreamChunk({ finishReason: 'tool_calls' }),
      '[DONE]',
    ]);
    stub.pushStream([
      openAiChatStreamChunk({
        delta: { role: 'assistant', content: 'Created smoke.txt and verification should pass.' },
      }),
      openAiChatStreamChunk({ finishReason: 'stop' }),
      '[DONE]',
    ]);

    const baseUrl = await stub.tryStart();
    if (!baseUrl) {
      throw new Error(
        'OpenAI streaming stub failed to bind; recovery verify regression test did not run',
      );
    }
    await writeOpenAiStubConfig(repo.path, baseUrl);

    try {
      const { exitCode, stdout } = await runCli([
        'run',
        '-r',
        repo.path,
        '--instruction',
        'Create a new file named smoke.txt at the repo root containing exactly: autopilot smoke.',
        '--verify',
        buildBunCommand('verify.ts'),
        '--output-format',
        'json',
        '--act-mode',
        'autopilot',
        '--mode',
        'yolo',
      ]);

      expect(exitCode).toBe(0);
      expect(await helper.readFile(repo.path, 'smoke.txt')).toBe('autopilot smoke\n');
      expect(stub.requests).toHaveLength(3);

      const payload = JSON.parse(stdout) as any;
      expect(payload.metadata.success).toBe(true);
      expect(payload.metadata.changed_files).toContain('smoke.txt');
    } finally {
      await stub.close();
    }
  }, 120000);

  it('emits successful headless json metadata for autopilot shell execution', async () => {
    const repo = await helper.createGitRepo({
      initialFiles: [
        { path: 'src/index.ts', content: 'console.log("hello");\n' },
        {
          path: 'mutate.ts',
          content: [
            'await Bun.write("src/index.ts", \'console.log("headless json autopilot");\\n\');',
            'console.log("shell-ok");',
            '',
          ].join('\n'),
        },
        { path: '.gitignore', content: '.salmonloop/\n' },
      ],
    });

    const stub = createOpenAiStreamingStub();
    stub.pushStream([
      openAiChatStreamChunk({
        delta: {
          role: 'assistant',
          tool_calls: [
            {
              index: 0,
              id: 'call-shell-exec',
              type: 'function',
              function: {
                name: 'shell.exec',
                arguments: JSON.stringify({ command: buildBunCommand('mutate.ts') }),
              },
            },
          ],
        },
      }),
      openAiChatStreamChunk({ finishReason: 'tool_calls' }),
      '[DONE]',
    ]);
    stub.pushStream([
      openAiChatStreamChunk({ delta: { role: 'assistant', content: 'done' } }),
      openAiChatStreamChunk({ finishReason: 'stop' }),
      '[DONE]',
    ]);

    const baseUrl = await stub.tryStart();
    if (!baseUrl) {
      return;
    }
    await writeOpenAiStubConfig(repo.path, baseUrl);

    try {
      const { exitCode, stdout } = await runCli([
        'run',
        '-r',
        repo.path,
        '--instruction',
        'Run mutate.ts',
        '--output-format',
        'json',
        '--act-mode',
        'autopilot',
        '--mode',
        'yolo',
      ]);

      expect(exitCode).toBe(0);
      const payload = JSON.parse(stdout) as any;
      expect(payload.metadata.success).toBe(true);
      expect(payload.metadata.changed_files).toContain('src/index.ts');
      expect(payload.metadata.audit_path).toBeTruthy();
      expect(await helper.readFile(repo.path, 'src/index.ts')).toBe(
        'console.log("headless json autopilot");\n',
      );
    } finally {
      await stub.close();
    }
  }, 120000);

  it('supports --continue selecting the latest session in headless stream-json', async () => {
    const repo = await helper.createGitRepo();
    const now = Date.now();
    await seedChatSession(repo.path, 'sess-old', now - 1000);
    await seedChatSession(repo.path, 'sess-new', now);

    const { exitCode, stdout } = await runCli([
      '-r',
      repo.path,
      '--continue',
      '-p',
      'hello',
      '--output-format',
      'stream-json',
      '--act-mode',
      'review',
      '--no-config-file',
    ]);

    expect(exitCode).toBe(0);
    const lines = stdout
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as any);

    expect(lines[0]).toMatchObject({
      session_id: 'sess-new',
      event: { type: 'start', command: 'run', repo_path: repo.path, instruction: 'hello' },
    });
  }, 120000);

  it('fails fast when context cache path is outside allowed roots in headless stream-json', async () => {
    const repo = await helper.createGitRepo();
    await helper.writeFile(
      repo.path,
      '.salmonloop/config/config.json',
      JSON.stringify(
        {
          version: 1,
          context: {
            cache: {
              mode: 'persistent',
              path: '../outside/context-cache.json',
              allowedRoots: ['.salmonloop/cache'],
            },
          },
        },
        null,
        2,
      ),
    );

    const { exitCode, stdout } = await runCli([
      '-r',
      repo.path,
      '-p',
      'hello',
      '--output-format',
      'stream-json',
      '--act-mode',
      'review',
    ]);

    expect(exitCode).toBe(1);
    const lines = stdout
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as any);
    const retryEvents = lines.filter((line) => line.event?.type === 'retry');
    const resultEvent = lines.find((line) => line.event?.type === 'result');
    expect(retryEvents).toHaveLength(0);
    expect(resultEvent?.event?.error_code).toBe('PERMISSION_DENIED_CONTEXT_CACHE_OUTSIDE_ROOT');
    expect(lines[lines.length - 1]).toMatchObject({
      event: { type: 'end', success: false, exit_code: 1 },
    });
  }, 120000);

  it('allows one-off outside-root context cache path with --allow-outside-cache-root in headless stream-json', async () => {
    const repo = await helper.createGitRepo();
    await helper.writeFile(
      repo.path,
      '.salmonloop/config/config.json',
      JSON.stringify(
        {
          version: 1,
          context: {
            cache: {
              mode: 'persistent',
              path: '../outside/context-cache.json',
              allowedRoots: ['.salmonloop/cache'],
            },
          },
        },
        null,
        2,
      ),
    );

    const { exitCode, stdout } = await runCli([
      '-r',
      repo.path,
      '-p',
      'hello',
      '--output-format',
      'stream-json',
      '--act-mode',
      'review',
      '--allow-outside-cache-root',
    ]);

    expect(exitCode).toBe(0);
    const lines = stdout
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as any);
    const retryEvents = lines.filter((line) => line.event?.type === 'retry');
    const resultEvent = lines.find((line) => line.event?.type === 'result');
    expect(retryEvents).toHaveLength(0);
    expect(resultEvent?.event?.success).toBe(true);
    expect(resultEvent?.event?.error_code).toBeUndefined();
    expect(lines[lines.length - 1]).toMatchObject({
      event: { type: 'end', success: true, exit_code: 0 },
    });
  }, 120000);

  it('supports deferred non-interactive permission approval and records requestId in audit', async () => {
    const repo = await helper.createGitRepo();

    await helper.writeFile(
      repo.path,
      '.salmonloop/config/config.json',
      JSON.stringify(
        {
          version: 1,
          context: {
            cache: {
              mode: 'persistent',
              path: '../outside/context-cache.json',
              allowedRoots: ['.salmonloop/cache'],
            },
          },
          toolAuthorization: {
            nonInteractive: {
              strategy: 'command',
              command: {
                cmd: 'bun -e console.log(JSON.stringify({outcome:"allow_once"}));',
              },
            },
          },
        },
        null,
        2,
      ),
    );

    const { exitCode, stdout } = await runCli([
      '-r',
      repo.path,
      '-p',
      'hello',
      '--output-format',
      'stream-json',
      '--act-mode',
      'review',
    ]);

    expect(exitCode).toBe(0);
    const lines = stdout
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as any);
    const retryEvents = lines.filter((line) => line.event?.type === 'retry');
    const resultEvent = lines.find((line) => line.event?.type === 'result');
    expect(retryEvents).toHaveLength(0);
    expect(resultEvent?.event?.attempts).toBe(1);
    expect(resultEvent?.event?.success).toBe(true);
    expect(resultEvent?.event?.audit_path).toBeTruthy();

    const auditPath = String(resultEvent?.event?.audit_path ?? '');
    expect(auditPath.length).toBeGreaterThan(0);
    const auditRaw = await helper.readFile(repo.path, path.relative(repo.path, auditPath), 'utf-8');
    const audit = JSON.parse(String(auditRaw)) as any;
    const eventsRefPath = String(audit.context?.eventsRef?.path ?? '');
    expect(eventsRefPath.length).toBeGreaterThan(0);
    const eventsRaw = await helper.readFile(
      repo.path,
      `.salmonloop/runtime/audit/${eventsRefPath}`,
      'utf-8',
    );
    const events = String(eventsRaw)
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as any);
    const permissionEvent = events.find((e: any) => e.action === 'permission.decision');
    expect(permissionEvent?.details?.decision).toBe('pending');
    expect(typeof permissionEvent?.details?.requestId).toBe('string');
    expect(permissionEvent?.details?.requestId.length).toBeGreaterThan(0);
  }, 120000);

  it('emits machine-readable errors when --resume session is missing in headless stream-json (native)', async () => {
    const repo = await helper.createGitRepo();

    const { exitCode, stdout } = await runCli([
      '-r',
      repo.path,
      '--resume',
      'sess-missing',
      '-p',
      'hello',
      '--output-format',
      'stream-json',
      '--act-mode',
      'review',
      '--no-config-file',
    ]);

    expect(exitCode).toBe(1);
    const lines = stdout
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as any);

    const normalized = normalizeHeadlessIntegrationLines({
      lines: pickNativeLifecycleLines(lines),
      repoPath: repo.path,
    });
    const expected = readJsonFixture<any[]>(
      new URL(
        '../fixtures/headless/integration/resume-missing-stream-json-native.json',
        import.meta.url,
      ),
    );
    expect(normalized).toEqual(expected);
  }, 120000);

  it('emits machine-readable errors when --resume session is corrupted in headless stream-json (native)', async () => {
    const repo = await helper.createGitRepo();
    await helper.writeFile(repo.path, '.salmonloop/chat-sessions/sess-missing.json', '{');

    const { exitCode, stdout } = await runCli([
      '-r',
      repo.path,
      '--resume',
      'sess-missing',
      '-p',
      'hello',
      '--output-format',
      'stream-json',
      '--act-mode',
      'review',
      '--no-config-file',
    ]);

    expect(exitCode).toBe(1);
    const lines = stdout
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as any);

    const normalized = normalizeHeadlessIntegrationLines({
      lines: pickNativeLifecycleLines(lines),
      repoPath: repo.path,
    });
    const expected = readJsonFixture<any[]>(
      new URL(
        '../fixtures/headless/integration/resume-missing-stream-json-native.json',
        import.meta.url,
      ),
    );
    expect(normalized).toEqual(expected);
  }, 120000);

  it('emits machine-readable errors when --resume session is missing in headless stream-json --output-profile anthropic', async () => {
    const repo = await helper.createGitRepo();

    const { exitCode, stdout } = await runCli([
      '-r',
      repo.path,
      '--resume',
      'sess-missing-anthropic',
      '-p',
      'hello',
      '--output-format',
      'stream-json',
      '--output-profile',
      'anthropic',
      '--act-mode',
      'review',
      '--no-config-file',
    ]);

    expect(exitCode).toBe(1);
    const lines = stdout
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as any);

    const normalized = normalizeHeadlessIntegrationLines({
      lines: pickAnthropicLifecycleLines(lines),
      repoPath: repo.path,
    });
    const expected = readJsonFixture<any[]>(
      new URL(
        '../fixtures/headless/integration/resume-missing-stream-json-anthropic.json',
        import.meta.url,
      ),
    );
    expect(normalized).toEqual(expected);
  }, 120000);

  it('emits machine-readable errors when --resume session is corrupted in headless stream-json --output-profile anthropic', async () => {
    const repo = await helper.createGitRepo();
    await helper.writeFile(repo.path, '.salmonloop/chat-sessions/sess-missing-anthropic.json', '{');

    const { exitCode, stdout } = await runCli([
      '-r',
      repo.path,
      '--resume',
      'sess-missing-anthropic',
      '-p',
      'hello',
      '--output-format',
      'stream-json',
      '--output-profile',
      'anthropic',
      '--act-mode',
      'review',
      '--no-config-file',
    ]);

    expect(exitCode).toBe(1);
    const lines = stdout
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as any);

    const normalized = normalizeHeadlessIntegrationLines({
      lines: pickAnthropicLifecycleLines(lines),
      repoPath: repo.path,
    });
    const expected = readJsonFixture<any[]>(
      new URL(
        '../fixtures/headless/integration/resume-missing-stream-json-anthropic.json',
        import.meta.url,
      ),
    );
    expect(normalized).toEqual(expected);
  }, 120000);

  it('emits OpenAI-compatible errors when --resume session is missing in headless stream-json --output-profile openai', async () => {
    const repo = await helper.createGitRepo();

    const { exitCode, stdout } = await runCli([
      '-r',
      repo.path,
      '--resume',
      'sess-missing-openai',
      '-p',
      'hello',
      '--output-format',
      'stream-json',
      '--output-profile',
      'openai',
      '--act-mode',
      'review',
      '--no-config-file',
    ]);

    expect(exitCode).toBe(1);
    const lines = stdout
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as any);

    const normalized = normalizeHeadlessIntegrationLines({
      lines: pickOpenAiLifecycleLines(lines),
      repoPath: repo.path,
    });
    const expected = readJsonFixture<any[]>(
      new URL(
        '../fixtures/headless/integration/resume-missing-stream-json-openai.json',
        import.meta.url,
      ),
    );
    expect(normalized).toEqual(expected);
  }, 120000);

  it('emits OpenAI-compatible errors when --resume session is corrupted in headless stream-json --output-profile openai', async () => {
    const repo = await helper.createGitRepo();
    await helper.writeFile(repo.path, '.salmonloop/chat-sessions/sess-missing-openai.json', '{');

    const { exitCode, stdout } = await runCli([
      '-r',
      repo.path,
      '--resume',
      'sess-missing-openai',
      '-p',
      'hello',
      '--output-format',
      'stream-json',
      '--output-profile',
      'openai',
      '--act-mode',
      'review',
      '--no-config-file',
    ]);

    expect(exitCode).toBe(1);
    const lines = stdout
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as any);

    const normalized = normalizeHeadlessIntegrationLines({
      lines: pickOpenAiLifecycleLines(lines),
      repoPath: repo.path,
    });
    const expected = readJsonFixture<any[]>(
      new URL(
        '../fixtures/headless/integration/resume-missing-stream-json-openai.json',
        import.meta.url,
      ),
    );
    expect(normalized).toEqual(expected);
  }, 120000);

  it('emits machine-readable unexpected errors when repo path is not a directory in headless stream-json (native)', async () => {
    const dir = await helper.createTempDir('not-a-repo-');
    const repoPath = path.join(dir, 'repo.txt');
    await helper.writeFile(dir, 'repo.txt', 'x');

    const { exitCode, stdout } = await runCli([
      '-r',
      repoPath,
      '-p',
      'hello',
      '--output-format',
      'stream-json',
      '--act-mode',
      'review',
      '--no-config-file',
    ]);

    expect(exitCode).toBe(1);
    const lines = stdout
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as any);

    const simplified = pickNativeLifecycleLines(lines).map((l) => ({
      ...l,
      session_id: '<session>',
    }));
    const normalized = normalizeHeadlessIntegrationLines({
      lines: simplified,
      repoPath,
    });

    const expected = readJsonFixture<any[]>(
      new URL(
        '../fixtures/headless/integration/unexpected-error-stream-json-native.json',
        import.meta.url,
      ),
    );
    expect(normalized).toEqual(expected);
  }, 120000);

  it('emits machine-readable unexpected errors when repo path is not a directory in headless stream-json --output-profile anthropic', async () => {
    const dir = await helper.createTempDir('not-a-repo-');
    const repoPath = path.join(dir, 'repo.txt');
    await helper.writeFile(dir, 'repo.txt', 'x');

    const { exitCode, stdout } = await runCli([
      '-r',
      repoPath,
      '-p',
      'hello',
      '--output-format',
      'stream-json',
      '--output-profile',
      'anthropic',
      '--act-mode',
      'review',
      '--no-config-file',
    ]);

    expect(exitCode).toBe(1);
    const lines = stdout
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as any);

    const simplified = pickAnthropicLifecycleLines(lines).map((l) => ({
      ...l,
      session_id: '<session>',
    }));
    const normalized = normalizeHeadlessIntegrationLines({
      lines: simplified,
      repoPath,
    });

    const expected = readJsonFixture<any[]>(
      new URL(
        '../fixtures/headless/integration/unexpected-error-stream-json-anthropic.json',
        import.meta.url,
      ),
    );
    expect(normalized).toEqual(expected);
  }, 120000);

  it('emits OpenAI-compatible unexpected errors when repo path is not a directory in headless stream-json --output-profile openai', async () => {
    const dir = await helper.createTempDir('not-a-repo-');
    const repoPath = path.join(dir, 'repo.txt');
    await helper.writeFile(dir, 'repo.txt', 'x');

    const { exitCode, stdout } = await runCli([
      '-r',
      repoPath,
      '-p',
      'hello',
      '--output-format',
      'stream-json',
      '--output-profile',
      'openai',
      '--act-mode',
      'review',
      '--no-config-file',
    ]);

    expect(exitCode).toBe(1);
    const lines = stdout
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as any);

    const normalized = normalizeHeadlessIntegrationLines({
      lines: pickOpenAiLifecycleLines(lines),
      repoPath,
    });
    const expected = readJsonFixture<any[]>(
      new URL(
        '../fixtures/headless/integration/unexpected-error-stream-json-openai.json',
        import.meta.url,
      ),
    );
    expect(normalized).toEqual(expected);
  }, 120000);

  it('emits machine-readable usage errors for Commander parse errors in headless json', async () => {
    const repo = await helper.createGitRepo();

    const { exitCode, stdout } = await runCli([
      '-r',
      repo.path,
      '-p',
      'hello',
      '--output-format',
      'json',
      '--unknown-flag',
      '--act-mode',
      'review',
      '--no-config-file',
    ]);

    expect(exitCode).toBe(1);
    const payload = JSON.parse(stdout) as any;
    expect(payload.structured_output).toBe(null);
    expect(payload.metadata).toMatchObject({
      command: 'run',
      repo_path: repo.path,
      instruction: 'hello',
      success: false,
      exit_code: 1,
      error_code: 'USAGE_ERROR',
    });
    expect(String(payload.metadata.reason)).toContain('unknown option');
  }, 120000);

  it('emits USAGE_ERROR for invalid act-mode in headless json', async () => {
    const repo = await helper.createGitRepo();

    const { exitCode, stdout } = await runCli([
      '-r',
      repo.path,
      '-p',
      'hello',
      '--output-format',
      'json',
      '--act-mode',
      'invalid-mode',
      '--no-config-file',
    ]);

    expect(exitCode).toBe(1);
    const payload = JSON.parse(stdout) as any;
    expect(payload.structured_output).toBe(null);
    expect(payload.metadata).toMatchObject({
      command: 'run',
      repo_path: repo.path,
      instruction: 'hello',
      success: false,
      exit_code: 1,
      error_code: 'USAGE_ERROR',
    });
    expect(String(payload.metadata.reason)).toContain('Invalid --act-mode');
  }, 120000);

  it('emits USAGE_ERROR for invalid environment-mode in headless json', async () => {
    const repo = await helper.createGitRepo();

    const { exitCode, stdout } = await runCli([
      '-r',
      repo.path,
      '-p',
      'hello',
      '--output-format',
      'json',
      '--act-mode',
      'review',
      '--environment-mode',
      'invalid-mode',
      '--no-config-file',
    ]);

    expect(exitCode).toBe(1);
    const payload = JSON.parse(stdout) as any;
    expect(payload.structured_output).toBe(null);
    expect(payload.metadata).toMatchObject({
      command: 'run',
      repo_path: repo.path,
      instruction: 'hello',
      success: false,
      exit_code: 1,
      error_code: 'USAGE_ERROR',
    });
    expect(String(payload.metadata.reason)).toContain('Invalid --environment-mode');
  }, 120000);

  it('emits machine-readable JSON for invalid permission mode in headless json', async () => {
    const repo = await helper.createGitRepo();

    const { exitCode, stdout } = await runCli([
      '-r',
      repo.path,
      '-p',
      'hello',
      '--output-format',
      'json',
      '--mode',
      'invalid',
      '--act-mode',
      'review',
      '--no-config-file',
    ]);

    expect(exitCode).toBe(1);
    const payload = JSON.parse(stdout) as any;
    expect(payload.structured_output).toBe(null);
    expect(payload.metadata).toMatchObject({
      command: 'run',
      repo_path: repo.path,
      instruction: 'hello',
      success: false,
      exit_code: 1,
      error_code: 'USAGE_ERROR',
    });
    expect(String(payload.metadata.reason)).toContain('Invalid --mode');
  }, 120000);

  it('emits machine-readable usage errors for Commander parse errors in headless stream-json (native)', async () => {
    const repo = await helper.createGitRepo();
    await seedChatSession(repo.path, 'sess-usage-native');

    const { exitCode, stdout } = await runCli([
      '-r',
      repo.path,
      '--resume',
      'sess-usage-native',
      '-p',
      'hello',
      '--output-format',
      'stream-json',
      '--unknown-flag',
      '--act-mode',
      'review',
      '--no-config-file',
    ]);

    expect(exitCode).toBe(1);
    const lines = stdout
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as any);

    expect(lines[0]).toMatchObject({
      session_id: 'sess-usage-native',
      event: { type: 'start', command: 'run', repo_path: repo.path, instruction: 'hello' },
    });
    expect(lines.some((l) => l.event?.type === 'error')).toBe(true);
    expect(lines[lines.length - 1]).toMatchObject({
      session_id: 'sess-usage-native',
      event: { type: 'end', success: false, exit_code: 1 },
    });

    const normalized = normalizeHeadlessIntegrationLines({
      lines: pickNativeLifecycleLines(lines),
      repoPath: repo.path,
    });
    const expected = readJsonFixture<any[]>(
      new URL(
        '../fixtures/headless/integration/usage-error-stream-json-native.json',
        import.meta.url,
      ),
    );
    expect(normalized).toEqual(expected);
  }, 120000);

  it('emits OpenAI-compatible usage errors for Commander parse errors in headless stream-json --output-profile openai', async () => {
    const repo = await helper.createGitRepo();

    const { exitCode, stdout } = await runCli([
      '-r',
      repo.path,
      '-p',
      'hello',
      '--output-format',
      'stream-json',
      '--output-profile',
      'openai',
      '--unknown-flag',
      '--act-mode',
      'review',
      '--no-config-file',
    ]);

    expect(exitCode).toBe(1);
    const lines = stdout
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as any);

    expect(
      lines.every((l) => typeof l.type === 'string' && typeof l.sequence_number === 'number'),
    ).toBe(true);
    expect(lines.some((l) => l.type === 'error')).toBe(true);
  }, 120000);

  it('prints machine-readable usage errors for --continue/--resume conflict when --output-format stream-json', async () => {
    const repo = await helper.createGitRepo();

    const { exitCode, stdout } = await runCli([
      'run',
      '-r',
      repo.path,
      '--continue',
      '--resume',
      'sess-conflict',
      '-i',
      'x',
      '--output-format',
      'stream-json',
      '--act-mode',
      'review',
      '--no-config-file',
    ]);

    expect(exitCode).toBe(1);
    const lines = stdout
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as any);

    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatchObject({ session_id: 'sess-conflict', event: { type: 'start' } });
    expect(lines[1]).toMatchObject({
      session_id: 'sess-conflict',
      event: {
        type: 'error',
        error: { message: expect.stringContaining('continue') },
      },
    });
    expect(lines[2]).toMatchObject({
      session_id: 'sess-conflict',
      event: { type: 'end', success: false, exit_code: 1 },
    });
  }, 120000);

  it('prints machine-readable usage errors for -p/-i conflict when --output-profile anthropic', async () => {
    const repo = await helper.createGitRepo();

    const { exitCode, stdout } = await runCli([
      'run',
      '-r',
      repo.path,
      '--resume',
      'sess-print-conflict',
      '-p',
      'hello',
      '-i',
      'x',
      '--output-format',
      'stream-json',
      '--output-profile',
      'anthropic',
      '--act-mode',
      'review',
      '--no-config-file',
    ]);

    expect(exitCode).toBe(1);
    const lines = stdout
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as any);

    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatchObject({
      type: 'start',
      session_id: 'sess-print-conflict',
      command: 'run',
      repo_path: repo.path,
      instruction: 'hello',
    });
    expect(lines[1]).toMatchObject({
      type: 'error',
      session_id: 'sess-print-conflict',
      error: { message: expect.stringContaining('--print') },
    });
    expect(lines[2]).toMatchObject({
      type: 'end',
      session_id: 'sess-print-conflict',
      success: false,
      exit_code: 1,
    });

    const normalized = normalizeHeadlessIntegrationLines({
      lines: pickAnthropicLifecycleLines(lines),
      repoPath: repo.path,
    });
    const expected = readJsonFixture<any[]>(
      new URL(
        '../fixtures/headless/integration/usage-error-stream-json-anthropic.json',
        import.meta.url,
      ),
    );
    expect(normalized).toEqual(expected);
  }, 120000);

  it('prints OpenAI-compatible usage errors when --output-profile openai', async () => {
    const repo = await helper.createGitRepo();

    const { exitCode, stdout } = await runCli([
      'run',
      '-r',
      repo.path,
      '--resume',
      'sess-openai',
      '-p',
      'hello',
      '-i',
      'x',
      '--output-format',
      'stream-json',
      '--output-profile',
      'openai',
      '--act-mode',
      'review',
      '--no-config-file',
    ]);

    expect(exitCode).toBe(1);
    const lines = stdout
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as any);

    expect(lines).toHaveLength(4);
    expect(lines[0]).toMatchObject({ type: 'response.created' });
    expect(lines[1]).toMatchObject({ type: 'response.in_progress' });
    expect(lines[2]).toMatchObject({ type: 'error' });
    expect(lines[3]).toMatchObject({ type: 'response.failed' });

    const normalized = normalizeHeadlessIntegrationLines({
      lines: pickOpenAiLifecycleLines(lines),
      repoPath: repo.path,
    });
    const expected = readJsonFixture<any[]>(
      new URL(
        '../fixtures/headless/integration/usage-error-stream-json-openai.json',
        import.meta.url,
      ),
    );
    expect(normalized).toEqual(expected);
  }, 120000);

  it('prints OpenAI-compatible usage errors for --json-schema when --output-profile openai', async () => {
    const repo = await helper.createGitRepo();

    const { exitCode, stdout } = await runCli([
      'run',
      '-r',
      repo.path,
      '-i',
      'x',
      '--output-format',
      'stream-json',
      '--output-profile',
      'openai',
      '--json-schema',
      '{}',
      '--act-mode',
      'review',
      '--no-config-file',
    ]);

    expect(exitCode).toBe(1);
    const lines = stdout
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as any);

    expect(lines).toHaveLength(4);
    expect(lines[0]).toMatchObject({ type: 'response.created' });
    expect(lines[1]).toMatchObject({ type: 'response.in_progress' });
    expect(lines[2]).toMatchObject({ type: 'error' });
    expect(lines[3]).toMatchObject({ type: 'response.failed' });
  }, 120000);

  it('rejects tool payload flags when --output-profile openai', async () => {
    const repo = await helper.createGitRepo();

    const { exitCode, stdout } = await runCli([
      'run',
      '-r',
      repo.path,
      '-i',
      'x',
      '--output-format',
      'stream-json',
      '--output-profile',
      'openai',
      '--headless-include-tool-input',
      '--act-mode',
      'review',
      '--no-config-file',
    ]);

    expect(exitCode).toBe(1);
    const lines = stdout
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as any);

    expect(lines).toHaveLength(4);
    expect(lines[0]).toMatchObject({ type: 'response.created' });
    expect(lines[1]).toMatchObject({ type: 'response.in_progress' });
    expect(lines[2]).toMatchObject({ type: 'error' });
    expect(lines[3]).toMatchObject({ type: 'response.failed' });
  }, 120000);

  it('rejects authorization decision flags when --output-profile openai', async () => {
    const repo = await helper.createGitRepo();

    const { exitCode, stdout } = await runCli([
      'run',
      '-r',
      repo.path,
      '-i',
      'x',
      '--output-format',
      'stream-json',
      '--output-profile',
      'openai',
      '--headless-include-authorization-decisions',
      '--act-mode',
      'review',
      '--no-config-file',
    ]);

    expect(exitCode).toBe(1);
    const lines = stdout
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as any);

    expect(lines).toHaveLength(4);
    expect(lines[0]).toMatchObject({ type: 'response.created' });
    expect(lines[1]).toMatchObject({ type: 'response.in_progress' });
    expect(lines[2]).toMatchObject({ type: 'error' });
    expect(lines[3]).toMatchObject({ type: 'response.failed' });
  }, 120000);

  it('prints machine-readable usage errors when --output-format stream-json', async () => {
    const repo = await helper.createGitRepo();

    const { exitCode, stdout } = await runCli([
      'run',
      '-r',
      repo.path,
      '-i',
      'x',
      '--output-format',
      'stream-json',
      '--json-schema',
      '{}',
      '--act-mode',
      'review',
      '--no-config-file',
    ]);

    expect(exitCode).toBe(1);
    const lines = stdout
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as any);

    expect(lines[0]).toMatchObject({ event: { type: 'start' } });
    expect(lines[1]).toMatchObject({
      event: {
        type: 'error',
        error: { message: expect.stringContaining('--json-schema') },
      },
    });
    expect(lines[2]).toMatchObject({ event: { type: 'end', success: false, exit_code: 1 } });
  }, 120000);

  it('prints machine-readable usage errors when --output-profile anthropic', async () => {
    const repo = await helper.createGitRepo();

    const { exitCode, stdout } = await runCli([
      'run',
      '-r',
      repo.path,
      '-i',
      'x',
      '--output-format',
      'stream-json',
      '--output-profile',
      'anthropic',
      '--json-schema',
      '{}',
      '--act-mode',
      'review',
      '--no-config-file',
    ]);

    expect(exitCode).toBe(1);
    const lines = stdout
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as any);

    expect(lines[0]).toMatchObject({ type: 'start', command: 'run' });
    expect(lines[1]).toMatchObject({
      type: 'error',
      error: { message: expect.stringContaining('--json-schema') },
    });
    expect(lines[2]).toMatchObject({ type: 'end', success: false, exit_code: 1 });
  }, 120000);

  it('fails the run if schema validation fails (strict mode)', async () => {
    const repo = await helper.createGitRepo();
    const schema = JSON.stringify({
      type: 'object',
      required: ['foo'],
      properties: { foo: { type: 'string' } },
      additionalProperties: true,
    });

    const { exitCode, stdout } = await runCli([
      'run',
      '-r',
      repo.path,
      '-i',
      'x',
      '--output-format',
      'json',
      '--json-schema',
      schema,
      '--act-mode',
      'review',
      '--no-config-file',
    ]);

    expect(exitCode).toBe(1);
    const payload = JSON.parse(stdout) as any;
    expect(payload.structured_output).toBe(null);
    expect(payload.metadata).toMatchObject({
      success: false,
      exit_code: 1,
      reason_code: 'SCHEMA_VALIDATION_FAILED',
      error_code: 'SCHEMA_VALIDATION_FAILED',
    });
  }, 120000);

  it('rejects --output-profile when --output-format is json', async () => {
    const repo = await helper.createGitRepo();

    const { exitCode, stdout } = await runCli([
      'run',
      '-r',
      repo.path,
      '-i',
      'x',
      '--output-format',
      'json',
      '--output-profile',
      'native',
      '--act-mode',
      'review',
      '--no-config-file',
    ]);

    expect(exitCode).toBe(1);
    const payload = JSON.parse(stdout) as any;
    expect(payload.structured_output).toBe(null);
    expect(payload.metadata).toMatchObject({
      command: 'run',
      repo_path: repo.path,
      instruction: 'x',
      success: false,
      exit_code: 1,
      error_code: 'USAGE_ERROR',
    });
    expect(String(payload.metadata.reason)).toContain('--output-profile');
  }, 120000);

  it('emits structured_output when schema validation succeeds', async () => {
    const repo = await helper.createGitRepo();
    const schema = JSON.stringify({
      type: 'object',
      required: ['command', 'repo_path', 'instruction', 'session_id', 'success', 'exit_code'],
      properties: {
        command: { const: 'run' },
        repo_path: { type: 'string' },
        instruction: { type: 'string' },
        session_id: { type: 'string' },
        success: { type: 'boolean' },
        exit_code: { type: 'number' },
      },
      additionalProperties: true,
    });

    const { exitCode, stdout } = await runCli([
      '-r',
      repo.path,
      '-p',
      'hello',
      '--output-format',
      'json',
      '--json-schema',
      schema,
      '--act-mode',
      'review',
      '--no-config-file',
    ]);

    expect(exitCode).toBe(0);
    const payload = JSON.parse(stdout) as any;
    expect(payload.structured_output).toMatchObject({
      command: 'run',
      repo_path: repo.path,
      instruction: 'hello',
      success: true,
      exit_code: 0,
    });
  }, 120000);

  it('fails strictly when structured output schema validation fails (loop success -> headless failure)', async () => {
    const repo = await helper.createGitRepo();
    const schema = JSON.stringify({
      type: 'object',
      required: ['command'],
      properties: {
        command: { const: 'chat' },
      },
      additionalProperties: true,
    });

    const { exitCode, stdout } = await runCli([
      '-r',
      repo.path,
      '-p',
      'hello',
      '--output-format',
      'json',
      '--json-schema',
      schema,
      '--act-mode',
      'review',
      '--no-config-file',
    ]);

    expect(exitCode).toBe(1);
    const payload = JSON.parse(stdout) as any;
    expect(payload.structured_output).toBe(null);
    expect(payload.metadata).toMatchObject({
      command: 'run',
      repo_path: repo.path,
      instruction: 'hello',
      success: false,
      exit_code: 1,
      reason_code: 'SCHEMA_VALIDATION_FAILED',
      error_code: 'SCHEMA_VALIDATION_FAILED',
    });
    expect(String(payload.metadata.structured_output_error)).toContain('schema validation');
  }, 120000);

  it('fails strictly when the JSON schema input is invalid', async () => {
    const repo = await helper.createGitRepo();

    const { exitCode, stdout } = await runCli([
      '-r',
      repo.path,
      '-p',
      'hello',
      '--output-format',
      'json',
      '--json-schema',
      '{',
      '--act-mode',
      'review',
      '--no-config-file',
    ]);

    expect(exitCode).toBe(1);
    const payload = JSON.parse(stdout) as any;
    expect(payload.structured_output).toBe(null);
    expect(payload.metadata).toMatchObject({
      command: 'run',
      repo_path: repo.path,
      instruction: 'hello',
      success: false,
      exit_code: 1,
      reason_code: 'SCHEMA_VALIDATION_FAILED',
      error_code: 'SCHEMA_INVALID',
    });
    expect(String(payload.metadata.reason)).toContain('Failed to load JSON schema');
  }, 120000);
});
