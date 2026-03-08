import { describe, expect, it } from 'bun:test';

type TaskFailure = {
  code: string;
  category?: 'verification' | 'runtime' | 'policy' | 'infrastructure';
  message: string;
  retryable?: boolean;
};

async function runPromptWithFailure(failure: TaskFailure): Promise<string> {
  const updates: any[] = [];
  const conn = {
    sessionUpdate: async (input: any) => {
      updates.push(input);
    },
  };

  const taskId = 'task_1';
  const now = new Date().toISOString();
  const latest = {
    id: taskId,
    capability: 'patch',
    state: 'failed',
    createdAt: now,
    attempt: 1,
    request: { instruction: 'Do work', repoPath: 'C:/repo' },
    failure,
  };

  const controller = new AbortController();

  const facade = {
    createTask: async (_input: any) => ({
      task: {
        id: taskId,
        capability: 'patch',
        state: 'accepted',
        createdAt: now,
        attempt: 1,
        request: { instruction: 'Do work', repoPath: 'C:/repo' },
      },
      signal: controller.signal,
    }),
    getTask: async (_id: string) => latest,
    cancelTask: async (_id: string) => null,
  };

  const eventBus = {
    subscribe: (_listener: any) => () => {},
    list: (_taskId: string) => [{ type: 'task.failed', taskId }],
  };

  const { createAcpFormalAgent } = await import('../../../src/core/protocols/acp/formal-agent.js');

  const agent = createAcpFormalAgent({
    conn: conn as any,
    agentInfo: { name: 'test-agent', version: '0.0.0' },
    facade: facade as any,
    eventBus: eventBus as any,
  });

  await agent.initialize({
    protocolVersion: 1,
    clientCapabilities: { fs: {}, terminal: false },
  } as any);

  const { sessionId } = await agent.newSession({ cwd: 'C:/repo', mcpServers: [] } as any);

  const res = await agent.prompt({
    sessionId,
    prompt: [{ type: 'text', text: 'Run task' }],
  } as any);

  return res.stopReason;
}

describe('ACP formal agent stopReason mapping', () => {
  it('maps token-limit failures to max_tokens', async () => {
    const stopReason = await runPromptWithFailure({
      code: 'LLM_CONTEXT_LENGTH_EXCEEDED',
      category: 'runtime',
      message: 'Context length exceeded',
      retryable: false,
    });
    expect(stopReason).toBe('max_tokens');
  });

  it('maps turn-request budget failures to max_turn_requests', async () => {
    const stopReason = await runPromptWithFailure({
      code: 'MAX_TURN_REQUESTS_EXCEEDED',
      category: 'runtime',
      message: 'Max turn requests exceeded',
      retryable: false,
    });
    expect(stopReason).toBe('max_turn_requests');
  });

  it('maps policy failures to refusal', async () => {
    const stopReason = await runPromptWithFailure({
      code: 'PERMISSION_RULE_DENY',
      category: 'policy',
      message: 'Permission denied by policy',
      retryable: false,
    });
    expect(stopReason).toBe('refusal');
  });
});
