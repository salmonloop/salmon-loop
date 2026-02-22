import { describe, expect, it, vi, beforeEach } from 'vitest';

import { text } from '../../../../src/cli/locales/index.js';

const listAgentsMock = vi.fn();
const getAgentMock = vi.fn();
const tailLogsMock = vi.fn();
const requestStopMock = vi.fn();

vi.mock('../../../../src/core/sub-agent/controller.js', () => ({
  SubAgentController: {
    listAgents: (...args: any[]) => listAgentsMock(...args),
    getAgent: (...args: any[]) => getAgentMock(...args),
    tailLogs: (...args: any[]) => tailLogsMock(...args),
    requestStop: (...args: any[]) => requestStopMock(...args),
  },
}));

const emitMock = vi.fn();

function createContext(input: string) {
  return {
    emit: emitMock,
    input,
    sessionManager: {} as any,
    dispatch: vi.fn(),
  };
}

describe('Sub-agent slash command', () => {
  async function loadCommand() {
    return (await import('../../../../src/cli/commands/subagent.js')).subAgentCommand;
  }

  beforeEach(() => {
    emitMock.mockClear();
    listAgentsMock.mockReset();
    getAgentMock.mockReset();
    tailLogsMock.mockReset();
    requestStopMock.mockReset();
  });

  it('offers the defined verbs as suggestions', async () => {
    const subAgentCommand = await loadCommand();
    listAgentsMock.mockReturnValue([]);

    const suggestions = await subAgentCommand.getSuggestions!({ input: '/smallfry ' } as any);
    const names = suggestions.map((entry) => entry.name);

    expect(names).toHaveLength(4);
    expect(names).toEqual(expect.arrayContaining(['list', 'info', 'log', 'stop']));
  });

  it('filters agent ids after verb selection', async () => {
    const subAgentCommand = await loadCommand();
    listAgentsMock.mockReturnValue([
      { id: 'agent-alpha', status: 'running', profile: { role: 'pilot' } },
      { id: 'agent-beta', status: 'idle', profile: { role: 'scout' } },
    ]);

    const suggestions = await subAgentCommand.getSuggestions!({
      input: '/smallfry info agent-b',
    } as any);

    expect(suggestions).toEqual([{ name: 'agent-beta', description: 'idle (scout)' }]);
  });

  it('emits usage when no verb is supplied', async () => {
    const subAgentCommand = await loadCommand();
    await subAgentCommand.execute(createContext('/smallfry'));

    expect(emitMock).toHaveBeenCalledTimes(1);
    expect(emitMock.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        level: 'info',
        message: text.cli.subagentUsage,
      }),
    );
  });

  it('warns on unknown verb', async () => {
    const subAgentCommand = await loadCommand();
    await subAgentCommand.execute(createContext('/smallfry dance'));

    expect(emitMock).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'warn',
        message: text.cli.subagentUnknownVerb('dance'),
      }),
    );
  });

  it('lists available agents', async () => {
    const subAgentCommand = await loadCommand();
    listAgentsMock.mockReturnValue([
      {
        id: 'alpha',
        status: 'running',
        profile: { role: 'pilot' },
        summary: 'exploring',
        stopRequested: false,
      },
    ]);

    await subAgentCommand.execute(createContext('/smallfry list'));

    expect(emitMock).toHaveBeenCalledTimes(1);

    const { message } = emitMock.mock.calls[0][0];
    expect(message).toContain(text.cli.subagentListHeader);
    expect(message).toContain('alpha | running | pilot | exploring');
  });

  it('reports info for a known agent', async () => {
    const subAgentCommand = await loadCommand();
    const agent = {
      id: 'alpha',
      status: 'running',
      profile: { role: 'pilot' },
      summary: 'exploring',
      stopRequested: false,
    };
    getAgentMock.mockReturnValue(agent);

    await subAgentCommand.execute(createContext('/smallfry info alpha'));

    expect(emitMock).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'info',
        message: `${text.cli.subagentInfoHeader(agent.id)}\nRole: ${agent.profile.role}\nStatus: ${agent.status}\nSummary: ${agent.summary}\nStop requested: no`,
      }),
    );
  });

  it('warns when requesting info without an id', async () => {
    const subAgentCommand = await loadCommand();
    await subAgentCommand.execute(createContext('/smallfry info'));

    expect(emitMock).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'warn',
        message: text.cli.subagentMissingId('info'),
      }),
    );
  });

  it('logs fallback text when no entries exist', async () => {
    const subAgentCommand = await loadCommand();
    const agentId = 'alpha';
    getAgentMock.mockReturnValue({ id: agentId });
    tailLogsMock.mockReturnValue([]);

    await subAgentCommand.execute(createContext('/smallfry log alpha tail=abc'));

    expect(tailLogsMock).toHaveBeenCalledWith(agentId, 20);
    expect(emitMock).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'info',
        message: `${text.cli.subagentLogHeader(agentId)}\n(no recent log entries)`,
      }),
    );
  });

  it('requests stop and notifies user', async () => {
    const subAgentCommand = await loadCommand();
    const agentId = 'alpha';
    getAgentMock.mockReturnValue({ id: agentId });

    await subAgentCommand.execute(createContext('/smallfry stop alpha'));

    expect(requestStopMock).toHaveBeenCalledWith(agentId);
    expect(emitMock).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'info',
        message: text.cli.subagentStopRequested(agentId),
      }),
    );
  });
});
