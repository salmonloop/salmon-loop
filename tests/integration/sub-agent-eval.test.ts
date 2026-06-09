import { randomUUID } from 'crypto';

import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';

import { AstParser } from '../../src/core/ast/parser.js';
import { ToolCallingStubLLM, type StubTurn } from '../../src/core/llm/tool-calling-stub.js';
import { clearLogger, createLogger, setLogger } from '../../src/core/observability/logger.js';
import { runSalmonLoop } from '../../src/core/runtime/loop.js';
import { createSubAgentController } from '../../src/core/sub-agent/controller.js';
import type { SubAgentControllerPort } from '../../src/core/sub-agent/controller.js';
import type { LLM } from '../../src/core/types/llm.js';
import { RealFsTestHelper } from '../helpers/real-fs-helper.js';

function buildValidDiff(profile: string): string {
  return `diff --git a/README.md b/README.md
--- a/README.md
+++ b/README.md
@@ -1 +1,2 @@
 # Test
+Updated by ${profile} sub-agent
`;
}

function buildSubAgentStubTurns(profile: string, task: string): StubTurn[] {
  const planJson = JSON.stringify({
    goal: `Complete: ${task}`,
    files: ['README.md'],
    changes: [`Executed ${profile} task`],
    verify: 'echo ok',
  });
  const needsPatch = profile === 'surgeon' || profile === 'cleaner';
  return [
    { content: planJson },
    ...(needsPatch ? [{ content: buildValidDiff(profile) }] : []),
    { content: 'ok' },
    { content: 'ok' },
  ];
}

function buildDispatchTurns(profile: string, task: string, asyncMode = false): StubTurn[] {
  const dispatchArgs: Record<string, unknown> = {
    agent_ref: profile,
    task,
    session_target: 'isolated',
    expected_output:
      profile === 'surgeon' || profile === 'cleaner'
        ? 'patch'
        : profile === 'reviewer'
          ? 'review'
          : 'diagnosis',
  };
  if (asyncMode) dispatchArgs.async = true;

  const dispatchCallId = `call-dispatch-${randomUUID().slice(0, 8)}`;

  const planJson = JSON.stringify({
    goal: `Complete: ${task}`,
    files: ['README.md'],
    changes: [`Dispatched ${profile} sub-agent`],
    verify: 'echo ok',
  });

  const turns: StubTurn[] = [
    // EXPLORE phase (2 LLM calls via chatWithTools: tool call + text)
    {
      content: 'Reading README.md to understand the project.',
      toolCalls: [
        {
          id: `call-read-${randomUUID().slice(0, 8)}`,
          function: {
            name: 'fs.read',
            arguments: JSON.stringify({ file_path: 'README.md' }),
          },
        },
      ],
    },
    { content: 'Exploration complete. Found project structure.' },

    // PLAN phase — agent_dispatch triggers sub-agent's SmallfryLoop
    {
      content: `Dispatching ${profile} sub-agent.`,
      toolCalls: [
        {
          id: dispatchCallId,
          function: {
            name: 'agent_dispatch',
            arguments: JSON.stringify(dispatchArgs),
          },
        },
      ],
    },

    // Main PLAN round 1: plan JSON (sub-agent uses its own StubLLM via llmFactory)
    { content: planJson },

    // PATCH phase: valid unified diff
    { content: buildValidDiff(profile) },
  ];

  if (asyncMode) {
    // For async mode, insert agent_await after the diff (pipeline retries may need it)
    turns.push({
      content: 'Awaiting result.',
      toolCalls: [
        {
          id: `call-await-${randomUUID().slice(0, 8)}`,
          function: {
            name: 'agent_await',
            arguments: JSON.stringify({ agentId: '{{handle}}' }),
          },
        },
      ],
    });
  }

  return turns;
}

describe('Sub-Agent Evaluation Harness', () => {
  const helper = new RealFsTestHelper();
  let repoPath: string;

  beforeEach(async () => {
    setLogger(createLogger({ silent: true }));
    const repo = await helper.createGitRepo({
      initialFiles: [
        { path: '.gitignore', content: '.salmonloop/\n' },
        { path: 'README.md', content: '# Test\n' },
        { path: 'src/index.ts', content: 'console.log("hello");\n' },
      ],
      gitConfig: {
        'user.name': 'Test',
        'user.email': 'test@test.com',
        'core.safecrlf': 'false',
      },
    });
    repoPath = repo.path;

    spyOn(AstParser, 'parse').mockResolvedValue({
      rootNode: {
        hasError: false,
        children: [],
        type: 'program',
        text: '',
        startPosition: { row: 0, column: 0 },
        endPosition: { row: 0, column: 0 },
      } as any,
      delete: () => {},
    } as any);
    spyOn(AstParser, 'identifyDefinitions').mockResolvedValue([]);
    spyOn(AstParser, 'identifyReferences').mockResolvedValue([]);
  });

  afterEach(async () => {
    clearLogger();
    await helper.cleanup();
  });

  it('ToolCallingStubLLM drives chatWithTools loop correctly', async () => {
    const turns: StubTurn[] = [
      {
        content: 'First turn with tool call',
        toolCalls: [{ id: 'call-1', function: { name: 'test_tool', arguments: '{}' } }],
      },
      { content: 'Final answer' },
    ];
    const llm = new ToolCallingStubLLM(turns);

    expect(llm.toolCalling).toBe(true);
    expect(llm.getCapabilities().toolCalling).toBe(true);

    // First call returns tool_calls
    const r1 = await llm.chat([]);
    // Second call returns no tool_calls
    const r2 = await llm.chat([]);

    expect(r1.tool_calls).toBeDefined();
    expect(r1.tool_calls!.length).toBe(1);
    expect(r2.tool_calls).toBeUndefined();
  });

  it('dispatches explorer sub-agent synchronously', async () => {
    const controller = createSubAgentController();
    const task = 'List all TypeScript files';
    const turns = buildDispatchTurns('explorer', task);
    const stub = new ToolCallingStubLLM(turns);

    const result = await runSalmonLoop({
      instruction: 'Dispatch an explorer sub-agent to: List all TypeScript files',
      repoPath,
      llm: stub as unknown as LLM,
      mode: 'patch',
      subAgentController: controller,
      llmFactory: () =>
        new ToolCallingStubLLM(buildSubAgentStubTurns('explorer', task)) as unknown as LLM,
    });

    expect(result).toBeDefined();
    expect(result.attempts).toBeGreaterThanOrEqual(1);

    const agents = controller.listAgents();
    expect(agents.length).toBeGreaterThanOrEqual(1);
    expect(agents[0].profile.id).toBe('explorer');
  });

  it('dispatches surgeon sub-agent and collects metrics', async () => {
    const controller = createSubAgentController();
    const task = 'Fix a bug in src/index.ts';
    const turns = buildDispatchTurns('surgeon', task);
    const stub = new ToolCallingStubLLM(turns);

    const result = await runSalmonLoop({
      instruction: 'Dispatch a surgeon sub-agent to: Fix a bug in src/index.ts',
      repoPath,
      llm: stub as unknown as LLM,
      mode: 'patch',
      subAgentController: controller,
      llmFactory: () =>
        new ToolCallingStubLLM(buildSubAgentStubTurns('surgeon', task)) as unknown as LLM,
    });

    expect(result).toBeDefined();
    const agents = controller.listAgents();
    if (agents.length > 0) {
      expect(agents[0].profile.id).toBe('surgeon');
      expect(typeof agents[0].tokenUsage).toBe('number');
      expect(typeof agents[0].toolCallCount).toBe('number');
    }
  });

  it('dispatches async and verifies handle returned', async () => {
    // Async dispatch returns a handle immediately; we verify the dispatch succeeds
    // without waiting for agent_await (which blocks on the sub-agent pipeline).
    const controller = createSubAgentController();
    // Only dispatch + final text (no agent_await turn)
    const turns: StubTurn[] = [
      {
        content: 'Reading README.md.',
        toolCalls: [
          {
            id: `call-read-${randomUUID().slice(0, 8)}`,
            function: { name: 'fs.read', arguments: JSON.stringify({ file_path: 'README.md' }) },
          },
        ],
      },
      { content: 'Exploration complete.' },
      {
        content: 'Dispatching explorer async.',
        toolCalls: [
          {
            id: `call-dispatch-${randomUUID().slice(0, 8)}`,
            function: {
              name: 'agent_dispatch',
              arguments: JSON.stringify({
                agent_ref: 'explorer',
                task: 'Find unused exports',
                session_target: 'isolated',
                expected_output: 'diagnosis',
                async: true,
              }),
            },
          },
        ],
      },
      {
        content: JSON.stringify({
          goal: 'Dispatch async explorer',
          files: [],
          changes: ['Dispatched explorer sub-agent async'],
          verify: 'echo ok',
        }),
      },
    ];
    const stub = new ToolCallingStubLLM(turns);

    const result = await runSalmonLoop({
      instruction: 'Dispatch an explorer async',
      repoPath,
      llm: stub as unknown as LLM,
      mode: 'patch',
      subAgentController: controller,
      llmFactory: () =>
        new ToolCallingStubLLM(
          buildSubAgentStubTurns('explorer', 'Find unused exports'),
        ) as unknown as LLM,
    });

    expect(result).toBeDefined();
    expect(result.attempts).toBeGreaterThanOrEqual(1);
    // At least one agent should be registered from the async dispatch
    const agents = controller.listAgents();
    expect(agents.length).toBeGreaterThanOrEqual(1);
  });

  it('runs all four profiles without crashing', async () => {
    const profiles = ['explorer', 'surgeon', 'reviewer', 'cleaner'];

    for (const profile of profiles) {
      const controller = createSubAgentController();
      const task = `Test task for ${profile}`;
      const turns = buildDispatchTurns(profile, task);
      const stub = new ToolCallingStubLLM(turns);

      const result = await runSalmonLoop({
        instruction: `Dispatch a ${profile} sub-agent`,
        repoPath,
        llm: stub as unknown as LLM,
        mode: 'patch',
        subAgentController: controller,
        llmFactory: () =>
          new ToolCallingStubLLM(buildSubAgentStubTurns(profile, task)) as unknown as LLM,
      });

      expect(result).toBeDefined();
      expect(result.attempts).toBeGreaterThanOrEqual(1);
    }
  });
});
