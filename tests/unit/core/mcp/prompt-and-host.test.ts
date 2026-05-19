import { describe, expect, it, mock } from 'bun:test';

import { McpPromptCommandProvider } from '../../../../src/core/mcp/bridge/prompt-command-provider.js';
import { McpElicitationProvider } from '../../../../src/core/mcp/host/elicitation-provider.js';
import { McpRootsProvider } from '../../../../src/core/mcp/host/roots-provider.js';
import {
  McpSamplingDeniedError,
  McpSamplingProvider,
} from '../../../../src/core/mcp/host/sampling-provider.js';
import { createSlashRegistry } from '../../../../src/core/slash/registry.js';
import { SlashRouter } from '../../../../src/core/slash/router.js';

describe('MCP prompt and host providers', () => {
  it('exposes MCP prompts as explicit slash/recipe entries and validates prompt args', async () => {
    const getPrompt = mock(async (_name: string, args: Record<string, string>) => ({
      description: 'Greeting prompt',
      messages: [
        { role: 'user' as const, content: { type: 'text' as const, text: `Hello ${args.name}` } },
      ],
    }));
    const provider = new McpPromptCommandProvider({
      serverName: 'local',
      client: {
        listPrompts: async () => [
          {
            name: 'greet',
            description: 'Greet someone',
            inputSchema: {
              type: 'object',
              properties: { name: { type: 'string' } },
              required: ['name'],
              additionalProperties: false,
            },
          },
        ],
        getPrompt,
      },
    });

    await provider.load();

    expect(provider.listSlashCommands()).toEqual([
      { name: '/mcp-local-greet', description: 'Greet someone', order: 230 },
    ]);
    expect(provider.listRecipes()[0]).toMatchObject({
      id: 'mcp.local.greet',
      slashCommand: '/mcp-local-greet',
      promptName: 'greet',
      serverName: 'local',
    });

    const invocation = await provider.invokePrompt('greet', { name: 'Ada' });
    expect(invocation.result.messages[0]?.content).toEqual({ type: 'text', text: 'Hello Ada' });
    expect(invocation.audit).toMatchObject({
      event: 'mcp.prompt.invoke',
      serverName: 'local',
      promptName: 'greet',
      args: { name: 'Ada' },
      messageCount: 1,
    });
    expect(getPrompt).toHaveBeenCalledWith('greet', { name: 'Ada' });
    await expect(provider.invokePrompt('greet', {})).rejects.toThrow();

    const registry = createSlashRegistry({ commands: provider.listSlashCommands() });
    const router = new SlashRouter({
      registry,
      handlers: provider,
      unknownSlashPolicy: 'block',
    });
    const decision = await router.dispatch('/mcp-local-greet {"name":"Lin"}');
    expect(decision).toEqual({ kind: 'forward', input: 'Hello Lin' });
  });

  it('limits roots by host exposure mode', () => {
    const none = new McpRootsProvider({
      repoRoot: '/repo',
      worktreeRoot: '/worktree',
      flowMode: 'patch',
      mode: 'none',
    }).listRoots();
    expect(none.roots).toEqual([]);
    expect(none._meta.audit.deniedReason).toBe('none_mode');

    const readOnly = new McpRootsProvider({
      repoRoot: '/repo',
      worktreeRoot: '/worktree',
      flowMode: 'answer',
      mode: 'read-only',
    }).listRoots();
    expect(readOnly.roots).toHaveLength(1);
    expect(readOnly.roots[0]?.uri).toBe('file:///repo');
    expect(readOnly._meta.audit.exposed).toEqual(['repoRoot']);

    const write = new McpRootsProvider({
      repoRoot: '/repo',
      worktreeRoot: '/worktree',
      flowMode: 'autopilot',
      mode: 'write',
    }).listRoots();
    expect(write.roots).toHaveLength(1);
    expect(write.roots[0]?.uri).toBe('file:///worktree');
    expect(write._meta.audit.exposed).toEqual(['worktreeRoot']);
  });

  it('denies sampling by default with a redacted audit payload', async () => {
    const provider = new McpSamplingProvider();

    await expect(
      provider.createMessage({
        messages: [{ role: 'user', content: { type: 'text', text: 'hello' } }],
        maxTokens: 100,
        metadata: { apiKey: 'sk-test-secret-1234567890' },
      }),
    ).rejects.toBeInstanceOf(McpSamplingDeniedError);

    try {
      await provider.createMessage({
        messages: [{ role: 'user', content: { type: 'text', text: 'hello' } }],
        maxTokens: 100,
        metadata: { apiKey: 'sk-test-secret-1234567890' },
      });
    } catch (error) {
      const denied = error as McpSamplingDeniedError;
      expect(denied.audit).toMatchObject({ event: 'mcp.sampling.deny', reason: 'disabled' });
      expect(JSON.stringify(denied.audit)).not.toContain('sk-test-secret');
    }
  });

  it('bridges elicitation ask through UserInputProvider and returns audit payload', async () => {
    const askUser = mock(async (input: any) => ({
      questions: input.questions,
      answers: { 'Pick a color': 'blue' },
    }));
    const provider = new McpElicitationProvider({
      userInputProvider: { askUser },
    });

    const response = await provider.elicit({
      mode: 'form',
      message: 'Need input',
      requestedSchema: {
        type: 'object',
        properties: {
          color: {
            type: 'string',
            title: 'Color',
            description: 'Pick a color',
            enum: ['red', 'blue'],
          },
        },
        required: ['color'],
      },
    });

    expect(response.result).toEqual({ action: 'accept', content: { color: 'blue' } });
    expect(response.audit).toMatchObject({
      event: 'mcp.elicitation.create',
      mode: 'form',
      action: 'accept',
      questionCount: 1,
    });
    expect(askUser).toHaveBeenCalledWith(
      {
        questions: [
          {
            question: 'Pick a color',
            header: 'Color',
            options: [
              { label: 'red', description: 'red' },
              { label: 'blue', description: 'blue' },
            ],
            multiSelect: false,
          },
        ],
      },
      { signal: undefined },
    );
  });
});
