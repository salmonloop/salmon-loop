import { afterEach, describe, expect, it } from 'bun:test';

import {
  runAutopilot,
  runAutopilotVerifyGate,
} from '../../src/core/grizzco/steps/autopilot.js';
import { createStandardToolstack } from '../../src/core/tools/loader.js';
import { ArtifactStore } from '../../src/core/sub-agent/artifacts/store.js';
import type { LLM, LLMMessage } from '../../src/core/types/index.js';
import { Phase } from '../../src/core/types/index.js';
import { buildBunCommand } from '../helpers/bun.js';
import { RealFsTestHelper } from '../helpers/real-fs-helper.js';

describe('autopilot direct preserve integration', () => {
  const helper = new RealFsTestHelper();

  afterEach(async () => {
    await helper.cleanup();
  });

  it('preserves shell-driven direct workspace mutations after failing verification and stores the output artifact', async () => {
    const repo = await helper.createGitRepo({
      initialFiles: [{ path: 'src/index.ts', content: 'console.log("hello");\n' }],
    });
    const repoPath = repo.path;

    await helper.writeFile(
      repoPath,
      'mutate.ts',
      [
        'await Bun.write("src/index.ts", \'console.log("autopilot kept this");\\n\');',
        '',
      ].join('\n'),
    );
    await helper.writeFile(
      repoPath,
      'verify.ts',
      'console.error("autopilot verify failed");\nprocess.exit(1);\n',
    );
    const mutateCommand = buildBunCommand('mutate.ts');
    let llmRounds = 0;

    const llm: LLM = {
      async chat(messages: LLMMessage[], options) {
        llmRounds += 1;
        expect(options?.phase).toBe(Phase.AUTOPILOT);
        const toolNames = (options?.tools ?? [])
          .map((tool: any) => tool?.function?.name)
          .filter((name: unknown): name is string => typeof name === 'string');
        expect(toolNames).toContain('shell.exec');

        const toolMessage = messages.find((message) => message.role === 'tool');
        if (!toolMessage) {
          return {
            role: 'assistant',
            content: '',
            tool_calls: [
              {
                id: 'call-shell-exec',
                type: 'function',
                function: {
                  name: 'shell.exec',
                  arguments: JSON.stringify({ command: mutateCommand }),
                },
              },
            ],
          };
        }

        expect(toolMessage.name).toBe('shell.exec');
        expect(JSON.parse(toolMessage.content)).toMatchObject({
          status: 'ok',
          output: {
            ok: true,
            exitCode: 0,
          },
        });

        return {
          role: 'assistant',
          content: 'Mutation applied.',
        };
      },
      getCapabilities: () => ({ toolCalling: true }),
      getModelId: () => 'gpt-test',
      async createPlan() {
        throw new Error('not used');
      },
      async createPatch() {
        throw new Error('not used');
      },
    };

    const toolstack = await createStandardToolstack({
      repoRoot: repoPath,
      persistenceRoot: repoPath,
      attemptId: 1,
      dryRun: false,
      model: 'gpt-test',
      authorizationMode: 'deferred',
      allowedToolNames: ['shell.exec'],
    });

    const autopilotCtx = await runAutopilot({
      preflightResult: { ok: true },
      workspace: {
        baseRepoPath: repoPath,
        workPath: repoPath,
        strategy: 'direct',
      },
      options: {
        instruction: 'Run the mutate script and then report the result.',
        llm,
        verify: buildBunCommand('verify.ts'),
        signal: undefined,
      },
      mode: 'autopilot',
      toolstack,
      emit: () => {},
      fs: {} as any,
      fileStateResolver: {} as any,
      shadowInitialRef: 'HEAD',
      artifactHints: {},
      toolCallingAudit: [],
    } as any);

    expect(llmRounds).toBe(2);
    expect(autopilotCtx.mutated).toBe(true);
    expect(autopilotCtx.toolCallingAudit).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          toolName: 'shell.exec',
          toolResultStatus: 'ok',
        }),
      ]),
    );

    const result = await runAutopilotVerifyGate(autopilotCtx);

    expect(result.verifyResult).toEqual(
      expect.objectContaining({
        ok: false,
        exitCode: 1,
      }),
    );
    expect(result.verifyResult?.output).toContain('autopilot verify failed');

    const content = await helper.readFile(repoPath, 'src/index.ts');
    expect(content).toBe('console.log("autopilot kept this");\n');

    expect(result.verifyArtifact).toBeDefined();
    const storedArtifact = await ArtifactStore.readText(result.verifyArtifact!.handle);
    expect(storedArtifact.ok).toBe(true);
    if (!storedArtifact.ok) {
      throw new Error('expected verify artifact to be readable');
    }
    expect(storedArtifact.content).toContain('autopilot verify failed');
  });
});
